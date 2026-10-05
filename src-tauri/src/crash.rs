// 異常終了の記録（2026-10-05）。フロント側の対になる部分は `src/ui/crash.ts`。
//
// 落ちても何も残らなかった（リリース版はログを一切書いていなかった）ので、
// 次の3つをアプリのデータフォルダの `crash/` へ書く:
//
// - フロントの未捕捉の例外（`record_crash` で受け取る）
// - Rust の panic（`install_panic_hook`）
// - **固まった**こと。フロントは自分の停止を書けないので、生存通知
//   （`heartbeat`）が途絶えたら見張り（`spawn_watchdog`）が書く
//
// vault には置かない。vault は git と同期の対象で、ノード以外を置かない決まり。
// 外へも送らない——次に起動したとき画面に出し、全文をコピーしてもらう。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::Manager;

/// 生存通知がこれだけ途絶えたら「固まった」と書く。フロントは 2 秒おきに送る。
/// 重い読み込み（実 vault 200 件で数百 ms）を誤検出しない幅を取ってある。
const HANG_AFTER: Duration = Duration::from_secs(8);
/// 見た記録をいくつ残すか。古いものから消す。
const KEEP_SEEN: usize = 30;

fn now_ms() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// ファイル名に使う時刻。並べたときに古い順になるよう、エポックミリ秒を桁揃えで頭に置く。
fn file_name(kind: &str) -> String {
  format!("{:015}-{kind}.log", now_ms())
}

static DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn dir() -> Option<&'static Path> {
  DIR.get().map(PathBuf::as_path)
}

/// 書けなくても投げない。記録の失敗で二次災害を起こさない。
fn write(kind: &str, body: &str) -> Option<PathBuf> {
  let dir = dir()?;
  fs::create_dir_all(dir).ok()?;
  let path = dir.join(file_name(kind));
  fs::write(&path, body).ok()?;
  Some(path)
}

pub fn init(app: &tauri::AppHandle) {
  if let Ok(base) = app.path().app_local_data_dir() {
    let _ = DIR.set(base.join("crash"));
  }
}

/// panic を書く。既定のフック（標準エラーへの出力）も呼ぶ——開発中に端末で見えなくなると困る。
pub fn install_panic_hook(version: String) {
  let default = std::panic::take_hook();
  std::panic::set_hook(Box::new(move |info| {
    let backtrace = std::backtrace::Backtrace::force_capture();
    let thread = std::thread::current().name().unwrap_or("（名前なし）").to_string();
    let body = format!(
      "種類: 本体（Rust）の panic\n版: {version}\nスレッド: {thread}\n\n## メッセージ\n{info}\n\n## バックトレース\n{backtrace}\n"
    );
    write("panic", &body);
    default(info);
  }));
}

/// 本窓の生存通知の状態。別窓は見張らない（本窓が生きていれば操作は続けられる）。
struct Watch {
  last_beat: AtomicU64,
  /// 窓に焦点があるときだけ見張る。最小化や裏に回った WebView はタイマーが
  /// 間引かれるので、焦点の無いときの途絶えは「固まった」ではない。
  focused: AtomicBool,
  /// 今の途絶えを既に書いたか。書いたファイルは、回復したら追記する。
  reported: Mutex<Option<PathBuf>>,
  /// 直前の操作。生存通知に載ってくる最新のもの（フロントは変わったときだけ送る）。
  crumbs: Mutex<String>,
  version: Mutex<String>,
}

static WATCH: Watch = Watch {
  last_beat: AtomicU64::new(0),
  focused: AtomicBool::new(true),
  reported: Mutex::new(None),
  crumbs: Mutex::new(String::new()),
  version: Mutex::new(String::new()),
};

pub fn set_focused(focused: bool) {
  WATCH.focused.store(focused, Ordering::Relaxed);
  // 焦点が戻った瞬間を途絶えに数えない。裏にいた間は通知が間引かれている。
  if focused {
    WATCH.last_beat.store(now_ms(), Ordering::Relaxed);
  }
}

pub fn spawn_watchdog(version: String) {
  if let Ok(mut v) = WATCH.version.lock() {
    *v = version;
  }
  std::thread::Builder::new()
    .name("sirube-watchdog".into())
    .spawn(|| loop {
      std::thread::sleep(Duration::from_secs(1));
      let last = WATCH.last_beat.load(Ordering::Relaxed);
      // 初回の通知が来るまでは見張らない（起動中の読み込みを固まったと数えない）。
      if last == 0 || !WATCH.focused.load(Ordering::Relaxed) {
        continue;
      }
      let silent = now_ms().saturating_sub(last);
      if silent < HANG_AFTER.as_millis() as u64 {
        continue;
      }
      let Ok(mut reported) = WATCH.reported.lock() else { continue };
      if reported.is_some() {
        continue;
      }
      let crumbs = WATCH.crumbs.lock().map(|c| c.clone()).unwrap_or_default();
      let version = WATCH.version.lock().map(|v| v.clone()).unwrap_or_default();
      let body = format!(
        "種類: 画面が応答しない（生存通知が {} 秒途絶えた）\n版: {version}\n\n窓は残ったまま中身が止まる・消える形の不具合は、たいていこれか画面側の例外。\n同じ時刻の前後に「画面側の例外」の記録があれば、そちらが原因。\n\n## 直前の操作（古い順）\n{}\n",
        silent / 1000,
        if crumbs.is_empty() { "（記録なし）" } else { crumbs.as_str() },
      );
      *reported = write("hang", &body);
    })
    .ok();
}

/// フロントからの生存通知。`crumbs` は直前の操作が変わったときだけ載ってくる。
#[tauri::command]
pub fn heartbeat(crumbs: Option<String>) {
  WATCH.last_beat.store(now_ms(), Ordering::Relaxed);
  if let Some(c) = crumbs {
    if let Ok(mut slot) = WATCH.crumbs.lock() {
      *slot = c;
    }
  }
  // 途絶えの後に戻ってきた。止まっていたのは一時的だったと追記しておく——
  // 戻らなかった（窓を閉じるしかなかった）ものと区別できるように。
  if let Ok(mut reported) = WATCH.reported.lock() {
    if let Some(path) = reported.take() {
      if let Ok(mut body) = fs::read_to_string(&path) {
        body.push_str("\n## その後\n生存通知が戻った（一時的に止まっていただけで、操作は続けられた）。\n");
        let _ = fs::write(&path, body);
      }
    }
  }
}

/// フロントの未捕捉の例外を書く。中身はフロントで整形済み（`formatReport`）。
#[tauri::command]
pub fn record_crash(body: String) -> Result<(), String> {
  write("error", &body).map(|_| ()).ok_or_else(|| "記録を書けませんでした".into())
}

#[derive(serde::Serialize)]
pub struct Report {
  name: String,
  body: String,
}

/// まだ見せていない記録を返し、`seen/` へ移す。**次の起動で同じものを二度出さない。**
///
/// 「回復した」と追記された固まりは出さない——操作は続けられていたので、知らせると
/// 毎回の重い処理で騒ぐことになる。ファイルは残すので、後から見ることはできる。
#[tauri::command]
pub fn take_crash_reports() -> Vec<Report> {
  let Some(dir) = dir() else { return Vec::new() };
  let seen = dir.join("seen");
  let mut out = Vec::new();
  let Ok(entries) = fs::read_dir(dir) else { return out };
  let mut paths: Vec<PathBuf> = entries
    .filter_map(|e| e.ok().map(|e| e.path()))
    .filter(|p| p.is_file() && p.extension().is_some_and(|x| x == "log"))
    .collect();
  paths.sort();
  let _ = fs::create_dir_all(&seen);
  for path in paths {
    let Ok(body) = fs::read_to_string(&path) else { continue };
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let recovered = body.contains("## その後\n生存通知が戻った");
    if fs::rename(&path, seen.join(&name)).is_err() {
      continue; // 移せないものを返すと、毎回同じものが出る
    }
    if !recovered {
      out.push(Report { name, body });
    }
  }
  prune(&seen);
  out
}

fn prune(seen: &Path) {
  let Ok(entries) = fs::read_dir(seen) else { return };
  let mut paths: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.is_file()).collect();
  if paths.len() <= KEEP_SEEN {
    return;
  }
  paths.sort();
  for p in &paths[..paths.len() - KEEP_SEEN] {
    let _ = fs::remove_file(p);
  }
}
