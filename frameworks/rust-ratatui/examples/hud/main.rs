//! The DeepTip example for Ratatui: a strategy-game HUD in the terminal, in German and English, with the shared
//! glossaries.
//!
//! ```text
//! cargo run --example hud
//! ```
//!
//! Environment: `DEEPTIP_LANG=de|en` (default: German unless `LANG` is English, like the web demo);
//! `DEEPTIP_GLOSSARY=<folder>` points to another `glossary/`; `DEEPTIP_HUD_SECONDS=3` quits after three seconds.
//! Keys: `Tab` / `Shift+Tab` move the focus, `Enter` or `Space` press, `F1` or `?` explain the focused element,
//! `Esc` closes, `F6` switches windows, `q` quits.

mod scene;

use std::io::stdout;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use ratatui::crossterm::event::{
    self, DisableFocusChange, DisableMouseCapture, EnableFocusChange, EnableMouseCapture, KeyboardEnhancementFlags,
    PopKeyboardEnhancementFlags, PushKeyboardEnhancementFlags,
};
use ratatui::crossterm::execute;
use ratatui::crossterm::terminal::supports_keyboard_enhancement;

fn main() -> std::io::Result<()> {
    let lang = std::env::var("DEEPTIP_LANG")
        .ok()
        .or_else(|| std::env::var("LANG").ok().map(|l| l.chars().take(2).collect()))
        .filter(|l| l == "en")
        .unwrap_or_else(|| "de".to_owned());
    let glossary = std::env::var_os("DEEPTIP_GLOSSARY")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../glossary"));
    let quit_after =
        std::env::var("DEEPTIP_HUD_SECONDS").ok().and_then(|s| s.parse::<f64>().ok()).map(Duration::from_secs_f64);
    let mut hud = scene::Hud::new(&lang, &glossary);

    let mut terminal = ratatui::init(); // raw mode, alternate screen, restore on panic
                                        // clicks and plain pointer movement (hover); focus changes tell when the pointer left the terminal
    execute!(stdout(), EnableMouseCapture, EnableFocusChange)?;
    // key repeat and release events, Shift+Esc: where the terminal speaks the kitty keyboard protocol
    let enhanced = matches!(supports_keyboard_enhancement(), Ok(true));
    if enhanced {
        execute!(
            stdout(),
            PushKeyboardEnhancementFlags(
                KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES | KeyboardEnhancementFlags::REPORT_EVENT_TYPES
            )
        )?;
    }
    let result = run(&mut terminal, &mut hud, quit_after);
    if enhanced {
        execute!(stdout(), PopKeyboardEnhancementFlags)?;
    }
    execute!(stdout(), DisableFocusChange, DisableMouseCapture)?;
    ratatui::restore();
    result
}

fn run(
    terminal: &mut ratatui::DefaultTerminal,
    hud: &mut scene::Hud,
    quit_after: Option<Duration>,
) -> std::io::Result<()> {
    let started = Instant::now();
    while !hud.quit {
        terminal.draw(|f| hud.draw(f))?;
        // wake up for DeepTip's next timer (opening, grace, timer lock) or animation frame
        let mut wait = hud.dt.timeout().unwrap_or(Duration::from_millis(500));
        if let Some(limit) = quit_after {
            let left = limit.saturating_sub(started.elapsed());
            if left.is_zero() {
                break;
            }
            wait = wait.min(left);
        }
        if event::poll(wait)? {
            let ev = event::read()?;
            hud.handle(&ev);
        }
    }
    Ok(())
}
