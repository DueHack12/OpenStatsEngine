/*
 * OpenStatsEngine for Windows: the window you see in the taskbar.
 *
 * The server (ose-server.exe, next to this file) is a console program. Run on
 * its own it opens a console window that Windows labels with the console's
 * name and icon, not ours. So this small program runs it with no console, and
 * shows its output in a window of its own: our name, our icon in the taskbar.
 *
 * - Closing the window stops the server: we close its stdin, which it takes as
 *   the signal to shut down cleanly, and only kill it if it has not gone after
 *   a few seconds. A job object makes sure it never outlives us.
 * - The server prints "Local : http://..." and "Network : http://..." lines;
 *   we read them to know which address to open or copy.
 * - Anything given after our name (a shortcut's Target, say) is passed on, so
 *   --port 9000 or --data D:\stats work as they always did.
 *
 * Plain Win32, no runtime to install. Built by build/package.mjs with mingw-w64.
 */
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <commctrl.h>
#include <shellapi.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define APP_NAME L"OpenStatsEngine"
#define SERVER_EXE L"ose-server.exe"

#define IDC_STATUS 100
#define IDC_OPEN 101
#define IDC_COPY 102
#define IDC_RESTART 103
#define IDC_LOG 104
#define TIMER_COPIED 1

#define WM_APP_OUTPUT (WM_APP + 1) /* lParam: malloc'd UTF-16 text, wParam: generation */
#define WM_APP_EXITED (WM_APP + 2) /* wParam: generation, lParam: exit code */

/* The log keeps the newest output only, so a server left running for a season
   of games does not grow the window without end. */
#define LOG_MAX_CHARS 1000000

/* The logo's colours, so the log looks like part of the app. */
#define LOG_BG RGB(0x0F, 0x17, 0x2A)
#define LOG_FG RGB(0xE2, 0xE8, 0xF0)

static HINSTANCE gInst;
static HWND gWnd, gStatus, gOpen, gCopy, gRestart, gLog;
static HFONT gUiFont, gMonoFont;
static HBRUSH gLogBrush;
static int gDpi = 96;

static wchar_t gServerPath[MAX_PATH * 2];
static const wchar_t *gArgs = L"";

static HANDLE gJob;
static HANDLE gProc;           /* the running server, or NULL */
static HANDLE gStdin;          /* write end of its stdin; closing it stops it */
static volatile LONG gGen;     /* which start of the server messages belong to */
static BOOL gRunning, gClosing;

static wchar_t gLocalUrl[512], gNetworkUrl[512];
static wchar_t gLine[4096];
static size_t gLineLen;

static int S(int px) { return MulDiv(px, gDpi, 96); }

/* ------------------------------------------------------------------ text */

static void setStatus(const wchar_t *text) { SetWindowTextW(gStatus, text); }

static void appendLog(const wchar_t *text) {
  int len = GetWindowTextLengthW(gLog);
  if (len > LOG_MAX_CHARS) {
    /* Drop the oldest half, at a line boundary. */
    int line = (int)SendMessageW(gLog, EM_LINEFROMCHAR, len / 2, 0);
    int cut = (int)SendMessageW(gLog, EM_LINEINDEX, line + 1, 0);
    if (cut > 0) {
      SendMessageW(gLog, EM_SETSEL, 0, cut);
      SendMessageW(gLog, EM_REPLACESEL, FALSE, (LPARAM)L"");
    }
    len = GetWindowTextLengthW(gLog);
  }
  SendMessageW(gLog, EM_SETSEL, len, len);
  SendMessageW(gLog, EM_REPLACESEL, FALSE, (LPARAM)text);
}

/* "  Network     : http://192.168.1.42:8080" -> the URL, if the line is one. */
static BOOL urlAfter(const wchar_t *line, const wchar_t *label, wchar_t *out, size_t cap) {
  while (*line == L' ') line++;
  size_t n = wcslen(label);
  if (wcsncmp(line, label, n) != 0) return FALSE;
  const wchar_t *url = wcsstr(line, L"http://");
  if (!url) return FALSE;
  size_t i = 0;
  while (url[i] && url[i] != L' ' && i + 1 < cap) { out[i] = url[i]; i++; }
  out[i] = 0;
  return TRUE;
}

static void updateButtons(void) {
  EnableWindow(gOpen, gRunning && gLocalUrl[0]);
  EnableWindow(gCopy, gRunning && (gNetworkUrl[0] || gLocalUrl[0]));
  SetWindowTextW(gRestart, gProc ? L"Restart Server" : L"Start Server");
}

static void showRunning(void) {
  wchar_t s[700];
  if (gNetworkUrl[0]) wsprintfW(s, L"Running at %s", gNetworkUrl);
  else wsprintfW(s, L"Running at %s (no network found)", gLocalUrl);
  setStatus(s);
  updateButtons();
}

static void onLine(const wchar_t *line) {
  wchar_t url[512];
  if (urlAfter(line, L"Local", url, 512)) {
    wcscpy(gLocalUrl, url);
    gRunning = TRUE;
    showRunning();
  } else if (!gNetworkUrl[0] && urlAfter(line, L"Network", url, 512)) {
    wcscpy(gNetworkUrl, url);
    if (gRunning) showRunning();
  }
}

static void onOutput(const wchar_t *text) {
  for (const wchar_t *p = text; *p; p++) {
    if (*p == L'\n') {
      gLine[gLineLen] = 0;
      onLine(gLine);
      gLineLen = 0;
    } else if (*p != L'\r' && gLineLen + 1 < sizeof gLine / sizeof gLine[0]) {
      gLine[gLineLen++] = *p;
    }
  }
  appendLog(text);
}

/* -------------------------------------------------------------- threads */

typedef struct { HANDLE pipe; LONG gen; } Reader;

/* UTF-8 from the pipe -> UTF-16 with CRLF line ends, posted to the window. A
   character split across two reads is carried over to the next. */
static DWORD WINAPI readerThread(LPVOID arg) {
  Reader r = *(Reader *)arg;
  free(arg);
  char buf[8192 + 4];
  DWORD carry = 0, got;
  while (ReadFile(r.pipe, buf + carry, 8192, &got, NULL) && got) {
    DWORD n = carry + got, whole = n;
    /* Hold back an incomplete UTF-8 sequence at the end. */
    for (DWORD back = 1; back <= 3 && back <= n; back++) {
      unsigned char c = (unsigned char)buf[n - back];
      if ((c & 0xC0) == 0x80) continue;           /* continuation byte */
      DWORD need = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 1;
      if (need > back) whole = n - back;
      break;
    }
    int wn = MultiByteToWideChar(CP_UTF8, 0, buf, (int)whole, NULL, 0);
    wchar_t *w = malloc(((size_t)wn * 2 + 1) * sizeof(wchar_t));
    if (w) {
      wchar_t *tmp = malloc(((size_t)wn + 1) * sizeof(wchar_t));
      if (tmp) {
        MultiByteToWideChar(CP_UTF8, 0, buf, (int)whole, tmp, wn);
        int o = 0;
        for (int i = 0; i < wn; i++) {
          if (tmp[i] == L'\r') continue;
          if (tmp[i] == L'\n') w[o++] = L'\r';
          w[o++] = tmp[i];
        }
        w[o] = 0;
        free(tmp);
        if (!PostMessageW(gWnd, WM_APP_OUTPUT, (WPARAM)r.gen, (LPARAM)w)) free(w);
      } else free(w);
    }
    carry = n - whole;
    memmove(buf, buf + whole, carry);
  }
  CloseHandle(r.pipe);
  return 0;
}

typedef struct { HANDLE proc; LONG gen; } Waiter;

static DWORD WINAPI waiterThread(LPVOID arg) {
  Waiter w = *(Waiter *)arg;
  free(arg);
  DWORD code = 0;
  WaitForSingleObject(w.proc, INFINITE);
  GetExitCodeProcess(w.proc, &code);
  CloseHandle(w.proc);
  PostMessageW(gWnd, WM_APP_EXITED, (WPARAM)w.gen, (LPARAM)code);
  return 0;
}

/* --------------------------------------------------------------- server */

static void startServer(void) {
  SECURITY_ATTRIBUTES sa = { sizeof sa, NULL, TRUE };
  HANDLE outR = NULL, outW = NULL, inR = NULL, inW = NULL;
  gLocalUrl[0] = gNetworkUrl[0] = 0;
  gLineLen = 0;
  gRunning = FALSE;
  LONG gen = InterlockedIncrement(&gGen);

  if (!CreatePipe(&outR, &outW, &sa, 0) || !CreatePipe(&inR, &inW, &sa, 0)) {
    setStatus(L"Could not start the server (no pipe).");
    return;
  }
  SetHandleInformation(outR, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(inW, HANDLE_FLAG_INHERIT, 0);

  size_t cap = wcslen(gServerPath) + wcslen(gArgs) + 8;
  wchar_t *cmd = malloc(cap * sizeof(wchar_t));
  wsprintfW(cmd, L"\"%s\"%s%s", gServerPath, gArgs[0] ? L" " : L"", gArgs);

  STARTUPINFOW si;
  ZeroMemory(&si, sizeof si);
  si.cb = sizeof si;
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput = inR;
  si.hStdOutput = outW;
  si.hStdError = outW;
  PROCESS_INFORMATION pi;
  BOOL ok = CreateProcessW(gServerPath, cmd, NULL, NULL, TRUE, CREATE_NO_WINDOW,
                           NULL, NULL, &si, &pi);
  DWORD err = GetLastError();
  free(cmd);
  CloseHandle(outW);
  CloseHandle(inR);
  if (!ok) {
    CloseHandle(outR);
    CloseHandle(inW);
    wchar_t msg[512], s[700];
    FormatMessageW(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, NULL, err, 0, msg, 512, NULL);
    wsprintfW(s, L"Could not start the server: %s", msg);
    setStatus(s);
    appendLog(s);
    appendLog(L"\r\n");
    updateButtons();
    return;
  }
  if (gJob) AssignProcessToJobObject(gJob, pi.hProcess);
  CloseHandle(pi.hThread);
  gProc = pi.hProcess;
  gStdin = inW;

  Reader *r = malloc(sizeof *r);
  r->pipe = outR;
  r->gen = gen;
  CloseHandle(CreateThread(NULL, 0, readerThread, r, 0, NULL));

  Waiter *w = malloc(sizeof *w);
  DuplicateHandle(GetCurrentProcess(), pi.hProcess, GetCurrentProcess(), &w->proc, SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, 0);
  w->gen = gen;
  CloseHandle(CreateThread(NULL, 0, waiterThread, w, 0, NULL));

  setStatus(L"Starting the server\x2026");
  updateButtons();
}

/* Ask the server to stop, give it a few seconds to finish, then make sure. */
static void stopServer(void) {
  if (!gProc) return;
  HCURSOR old = SetCursor(LoadCursor(NULL, IDC_WAIT));
  if (gStdin) { CloseHandle(gStdin); gStdin = NULL; }
  if (WaitForSingleObject(gProc, 4000) == WAIT_TIMEOUT) TerminateProcess(gProc, 1);
  CloseHandle(gProc);
  gProc = NULL;
  gRunning = FALSE;
  SetCursor(old);
}

/* ------------------------------------------------------------- the window */

static void copyText(const wchar_t *text) {
  size_t bytes = (wcslen(text) + 1) * sizeof(wchar_t);
  if (!OpenClipboard(gWnd)) return;
  EmptyClipboard();
  HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, bytes);
  if (h) {
    memcpy(GlobalLock(h), text, bytes);
    GlobalUnlock(h);
    if (!SetClipboardData(CF_UNICODETEXT, h)) GlobalFree(h);
  }
  CloseClipboard();
}

static void layout(void) {
  RECT rc;
  GetClientRect(gWnd, &rc);
  int pad = S(10), bh = S(28), top = S(48);
  int wOpen = S(130), wCopy = S(170), wRestart = S(110);
  int x = rc.right - pad - wRestart;
  MoveWindow(gRestart, x, pad, wRestart, bh, TRUE);
  x -= S(8) + wCopy;
  MoveWindow(gCopy, x, pad, wCopy, bh, TRUE);
  x -= S(8) + wOpen;
  MoveWindow(gOpen, x, pad, wOpen, bh, TRUE);
  MoveWindow(gStatus, pad, pad + S(5), x - pad * 2 > 0 ? x - pad * 2 : 0, bh - S(5), TRUE);
  MoveWindow(gLog, 0, top, rc.right, rc.bottom - top > 0 ? rc.bottom - top : 0, TRUE);
}

static void makeFonts(void) {
  NONCLIENTMETRICSW ncm;
  ZeroMemory(&ncm, sizeof ncm);
  ncm.cbSize = sizeof ncm;
  SystemParametersInfoW(SPI_GETNONCLIENTMETRICS, sizeof ncm, &ncm, 0);
  gUiFont = CreateFontIndirectW(&ncm.lfMessageFont);
  gMonoFont = CreateFontW(-MulDiv(10, gDpi, 72), 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
                          DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                          CLEARTYPE_QUALITY, FIXED_PITCH | FF_MODERN, L"Consolas");
}

static HWND child(const wchar_t *cls, const wchar_t *text, DWORD style, int id) {
  HWND h = CreateWindowExW(0, cls, text, WS_CHILD | WS_VISIBLE | style, 0, 0, 0, 0,
                           gWnd, (HMENU)(INT_PTR)id, gInst, NULL);
  SendMessageW(h, WM_SETFONT, (WPARAM)gUiFont, FALSE);
  return h;
}

static LRESULT CALLBACK wndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
  case WM_CREATE:
    gWnd = hwnd;
    gStatus = child(L"STATIC", L"", SS_LEFT | SS_ENDELLIPSIS | SS_NOPREFIX, IDC_STATUS);
    gOpen = child(L"BUTTON", L"Open Stats Entry", BS_PUSHBUTTON | WS_TABSTOP, IDC_OPEN);
    gCopy = child(L"BUTTON", L"Copy Network Address", BS_PUSHBUTTON | WS_TABSTOP, IDC_COPY);
    gRestart = child(L"BUTTON", L"Restart Server", BS_PUSHBUTTON | WS_TABSTOP, IDC_RESTART);
    gLog = child(L"EDIT", L"", ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL | WS_VSCROLL | WS_TABSTOP, IDC_LOG);
    SendMessageW(gLog, WM_SETFONT, (WPARAM)gMonoFont, FALSE);
    SendMessageW(gLog, EM_SETLIMITTEXT, 0, 0);
    SendMessageW(gLog, EM_SETMARGINS, EC_LEFTMARGIN | EC_RIGHTMARGIN, MAKELPARAM(S(8), S(8)));
    layout();
    return 0;

  case WM_SIZE:
    layout();
    return 0;

  case WM_GETMINMAXINFO: {
    MINMAXINFO *mm = (MINMAXINFO *)lp;
    mm->ptMinTrackSize.x = S(560);
    mm->ptMinTrackSize.y = S(240);
    return 0;
  }

  case WM_CTLCOLORSTATIC:
  case WM_CTLCOLOREDIT:
    if ((HWND)lp == gLog) {
      SetTextColor((HDC)wp, LOG_FG);
      SetBkColor((HDC)wp, LOG_BG);
      return (LRESULT)gLogBrush;
    }
    break;

  case WM_COMMAND:
    switch (LOWORD(wp)) {
    case IDC_OPEN:
      if (gLocalUrl[0]) ShellExecuteW(hwnd, L"open", gLocalUrl, NULL, NULL, SW_SHOWNORMAL);
      return 0;
    case IDC_COPY:
      copyText(gNetworkUrl[0] ? gNetworkUrl : gLocalUrl);
      SetWindowTextW(gCopy, L"Copied");
      SetTimer(hwnd, TIMER_COPIED, 1500, NULL);
      return 0;
    case IDC_RESTART:
      if (gProc) {
        setStatus(L"Restarting\x2026");
        stopServer();
        appendLog(L"\r\n\x2014\x2014 Restarting \x2014\x2014\r\n");
      }
      startServer();
      return 0;
    }
    break;

  case WM_TIMER:
    if (wp == TIMER_COPIED) {
      KillTimer(hwnd, TIMER_COPIED);
      SetWindowTextW(gCopy, L"Copy Network Address");
    }
    return 0;

  case WM_APP_OUTPUT: {
    wchar_t *text = (wchar_t *)lp;
    if ((LONG)wp == gGen) onOutput(text);  /* not a server we already stopped */
    free(text);
    return 0;
  }

  case WM_APP_EXITED:
    if ((LONG)wp != gGen || gClosing) return 0;  /* an earlier server, or we are closing */
    if (gProc) { CloseHandle(gProc); gProc = NULL; }
    if (gStdin) { CloseHandle(gStdin); gStdin = NULL; }
    gRunning = FALSE;
    {
      wchar_t s[200];
      wsprintfW(s, L"The server stopped (exit code %ld). Its last words are below.", (long)lp);
      setStatus(s);
    }
    updateButtons();
    FlashWindow(hwnd, TRUE);
    return 0;

  case WM_CLOSE:
    gClosing = TRUE;
    setStatus(L"Stopping the server\x2026");
    UpdateWindow(gStatus);
    stopServer();
    DestroyWindow(hwnd);
    return 0;

  case WM_ENDSESSION:
    if (wp) { gClosing = TRUE; stopServer(); }
    return 0;

  case WM_DESTROY:
    PostQuitMessage(0);
    return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

/* Everything on our command line after our own name, exactly as typed. */
static const wchar_t *argsTail(void) {
  const wchar_t *p = GetCommandLineW();
  if (*p == L'"') {
    p++;
    while (*p && *p != L'"') p++;
    if (*p) p++;
  } else {
    while (*p && *p != L' ' && *p != L'\t') p++;
  }
  while (*p == L' ' || *p == L'\t') p++;
  return p;
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR cmdLine, int show) {
  (void)prev;
  (void)cmdLine;
  gInst = inst;

  /* ose-server.exe lives next to us. */
  DWORD n = GetModuleFileNameW(NULL, gServerPath, MAX_PATH * 2);
  wchar_t *slash = wcsrchr(gServerPath, L'\\');
  if (!n || !slash) return 1;
  wcscpy(slash + 1, SERVER_EXE);
  if (GetFileAttributesW(gServerPath) == INVALID_FILE_ATTRIBUTES) {
    MessageBoxW(NULL,
                L"OpenStatsEngine could not find " SERVER_EXE L", which should be next to it.\n\n"
                L"Unzip the whole download into a folder first (right-click the .zip, Extract All), "
                L"then open OpenStatsEngine.exe from that folder.",
                APP_NAME, MB_OK | MB_ICONERROR);
    return 1;
  }
  gArgs = argsTail();

  /* The server never outlives us, even if we are killed. Its own children
     (the browser it opens) are not part of this and stay open. */
  gJob = CreateJobObjectW(NULL, NULL);
  if (gJob) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION li;
    ZeroMemory(&li, sizeof li);
    li.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
    if (!SetInformationJobObject(gJob, JobObjectExtendedLimitInformation, &li, sizeof li)) {
      CloseHandle(gJob);
      gJob = NULL;
    }
  }
  /* The server knows from this that it is in our window, not a console. */
  SetEnvironmentVariableW(L"OSE_HOSTED", L"win");

  INITCOMMONCONTROLSEX icc = { sizeof icc, ICC_STANDARD_CLASSES };
  InitCommonControlsEx(&icc);

  HDC dc = GetDC(NULL);
  gDpi = GetDeviceCaps(dc, LOGPIXELSY);
  ReleaseDC(NULL, dc);
  makeFonts();
  gLogBrush = CreateSolidBrush(LOG_BG);

  WNDCLASSEXW wc;
  ZeroMemory(&wc, sizeof wc);
  wc.cbSize = sizeof wc;
  wc.lpfnWndProc = wndProc;
  wc.hInstance = inst;
  wc.hIcon = LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON, GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), 0);
  wc.hIconSm = LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0);
  wc.hCursor = LoadCursor(NULL, IDC_ARROW);
  wc.hbrBackground = (HBRUSH)(COLOR_BTNFACE + 1);
  wc.lpszClassName = L"OpenStatsEngineWindow";
  RegisterClassExW(&wc);

  HWND hwnd = CreateWindowExW(0, wc.lpszClassName, APP_NAME, WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
                              CW_USEDEFAULT, CW_USEDEFAULT, S(860), S(560), NULL, NULL, inst, NULL);
  if (!hwnd) return 1;
  ShowWindow(hwnd, show);
  UpdateWindow(hwnd);
  startServer();

  MSG m;
  while (GetMessageW(&m, NULL, 0, 0) > 0) {
    if (!IsDialogMessageW(hwnd, &m)) {
      TranslateMessage(&m);
      DispatchMessageW(&m);
    }
  }
  if (gJob) CloseHandle(gJob);
  return 0;
}
