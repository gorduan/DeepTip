//! The DeepTip example for egui: a strategy-game HUD in English and German. It uses the shared glossaries
//! (`glossary/core/` and `glossary/example/`) like the example of every DeepTip framework.
//!
//! ```text
//! cargo run --example hud
//! ```
//!
//! Environment: `DEEPTIP_LANG=de|en` picks the language (default: German unless `LANG` is English, like the web
//! demo); `DEEPTIP_GLOSSARY=<dir>` points to another `glossary/` folder; `DEEPTIP_HUD_SECONDS=3` closes the window
//! after three seconds (smoke test).

use std::path::PathBuf;
use std::time::{Duration, Instant};

use deeptip::{DeepTip, Event, MarkOptions, OutsideClick, Side};
use eframe::egui;

/// Texts of the example screen itself (not explanations: those live in the glossary).
fn text(lang: &str, key: &str) -> &'static str {
    let de = lang == "de";
    match key {
        "realm" => {
            if de {
                "Reich"
            } else {
                "Realm"
            }
        }
        "nobles" => {
            if de {
                "Adel"
            } else {
                "Nobles"
            }
        }
        "province" => {
            if de {
                "↖ Provinz"
            } else {
                "↖ Province"
            }
        }
        "prestige" => "Prestige ↗",
        "revolt" => {
            if de {
                "↙ Aufstand"
            } else {
                "↙ Revolt"
            }
        }
        "unrest" => {
            if de {
                "Unruhe ↘"
            } else {
                "Unrest ↘"
            }
        }
        "stability" => {
            if de {
                "Stabilität"
            } else {
                "Stability"
            }
        }
        "taxes" => {
            if de {
                "Steuern"
            } else {
                "Taxes"
            }
        }
        "low" => {
            if de {
                "niedrig"
            } else {
                "low"
            }
        }
        "normal" => "normal",
        "high" => {
            if de {
                "hoch"
            } else {
                "high"
            }
        }
        "try" => {
            if de {
                "Ausprobieren"
            } else {
                "Try it"
            }
        }
        "settings" => {
            if de {
                "Einstellungen"
            } else {
                "Settings"
            }
        }
        "index" => {
            if de {
                "Enzyklopädie (alle Begriffe)"
            } else {
                "Encyclopedia (every term)"
            }
        }
        "events" => {
            if de {
                "Ereignisse"
            } else {
                "Events"
            }
        }
        "delay" => {
            if de {
                "Verzögerung erstes Fenster"
            } else {
                "Delay of the first window"
            }
        }
        "lock" => {
            if de {
                "Einrasten nach Ruhezeit"
            } else {
                "Pin after resting"
            }
        }
        "off" => {
            if de {
                "aus"
            } else {
                "off"
            }
        }
        "outside" => {
            if de {
                "Klick daneben schließt"
            } else {
                "Click outside closes"
            }
        }
        "closeButtons" => {
            if de {
                "X-Knöpfe"
            } else {
                "X buttons"
            }
        }
        "pinButton" => {
            if de {
                "Nadel-Knopf"
            } else {
                "Pin button"
            }
        }
        "hints" => {
            if de {
                "Hinweiszeile"
            } else {
                "Hint line"
            }
        }
        "theme" => {
            if de {
                "Darstellung"
            } else {
                "Theme"
            }
        }
        "intro" => {
            if de {
                "Lass die Maus auf einem Knopf oben **ruhen**. Im Fenster sind [[deeptip.term|markierte Begriffe]]: \
             drüberfahren zeigt sie, ein Klick [[deeptip.pin|hält sie fest]]. Kreislauf zum Testen: \
             [[demo.stability]] → [[demo.unrest]] → [[demo.revolt]] → [[demo.stability]]. Die Knöpfe in den Ecken \
             prüfen die Platzierung am Bildschirmrand."
            } else {
                "**Rest** the pointer on a button at the top. The window contains [[deeptip.term|highlighted terms]]: \
             hover shows them, a click [[deeptip.pin|pins]] them. A loop to try: [[demo.stability]] → \
             [[demo.unrest]] → [[demo.revolt]] → [[demo.stability]]. The corner buttons test placement at the \
             screen edge."
            }
        }
        "controls" => {
            if de {
                "Steuerung: [[deeptip.mouse|Maus]] · [[deeptip.touch|Touch]] (lange drücken) · \
             [[deeptip.keyboard|Tastatur]] (`F1`, `Esc`, `F6`) · [[deeptip.gamepad|Controller]] (über \
             `DeepTip::action`). *Prestige* und *Gold* gibt es nur auf Deutsch – auf Englisch zeigen sie die \
             Rückfallsprache."
            } else {
                "Controls: [[deeptip.mouse|mouse]] · [[deeptip.touch|touch]] (long-press) · \
             [[deeptip.keyboard|keyboard]] (`F1`, `Esc`, `F6`) · [[deeptip.gamepad|gamepad]] (through \
             `DeepTip::action`). *Prestige* and *Gold* exist only in German – in English they show the fallback \
             language."
            }
        }
        _ => "?",
    }
}

/// 1250 → "1,250" (en) / "1.250" (de).
fn grouped(n: i64, lang: &str) -> String {
    let digits = n.abs().to_string();
    let sep = if lang == "de" { '.' } else { ',' };
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(sep);
        }
        out.push(c);
    }
    if n < 0 {
        out.insert(0, '-');
    }
    out
}

fn signed(v: i32) -> String {
    if v > 0 {
        format!("+{v}")
    } else {
        v.to_string()
    }
}

/// A HUD button with an explanation; while the pointer rests on it a thin bar fills (the "arming" hook).
fn hud_button(ui: &mut egui::Ui, dt: &mut DeepTip, label: &str, key: &str, opts: MarkOptions) -> egui::Response {
    let r = ui.button(label);
    dt.mark_with(&r, key, opts);
    if let Some(p) = dt.arming(&r) {
        let bar = egui::Rect::from_min_size(
            egui::pos2(r.rect.left(), r.rect.bottom() - 2.0),
            egui::vec2(r.rect.width() * p, 2.0),
        );
        ui.painter().rect_filled(bar, 0, ui.visuals().hyperlink_color);
    }
    r
}

struct Hud {
    dt: DeepTip,
    lang: String,
    stability: i32,
    tax: usize,
    gold: i64,
    query: String,
    log: Vec<String>,
    theme: egui::ThemePreference,
    started: Instant,
    exit_after: Option<Duration>,
}

impl Hud {
    fn new(lang: &str) -> Self {
        let mut dt = DeepTip::new(lang, &["de", "en"]);
        let glossary = std::env::var_os("DEEPTIP_GLOSSARY")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../glossary"));
        let failed = dt.set_sources(&[
            glossary.join("core").join("{locale}.json").display().to_string(),
            glossary.join("example").join("{locale}.json").display().to_string(),
        ]);
        for f in &failed {
            eprintln!("DeepTip example: cannot load {f}");
        }
        dt.engine.options.delay = 1000.0;
        let exit_after =
            std::env::var("DEEPTIP_HUD_SECONDS").ok().and_then(|s| s.parse::<f64>().ok()).map(Duration::from_secs_f64);
        Self {
            dt,
            lang: lang.to_owned(),
            stability: 1,
            tax: 1,
            gold: 1250,
            query: String::new(),
            log: vec![format!("DeepTip {} · egui", deeptip::VERSION)],
            theme: egui::ThemePreference::System,
            started: Instant::now(),
            exit_after,
        }
    }

    fn top_bar(&mut self, ui: &mut egui::Ui) {
        let lang = self.lang.clone();
        let t = |k| text(&lang, k);
        ui.horizontal_wrapped(|ui| {
            ui.heading("DeepTip");
            ui.add_space(8.0);
            hud_button(ui, &mut self.dt, t("realm"), "demo.realm", MarkOptions::default());
            let stab = format!("{} {}", t("stability"), signed(self.stability));
            if hud_button(ui, &mut self.dt, &stab, "demo.stability", MarkOptions::default()).clicked() {
                // the controls keep their own click action; DeepTip only adds the explanation
                self.stability = if self.stability >= 3 { -3 } else { self.stability + 1 };
            }
            let tax = format!("{}: {}", t("taxes"), t(["low", "normal", "high"][self.tax]));
            if hud_button(ui, &mut self.dt, &tax, "demo.taxes", MarkOptions::default()).clicked() {
                self.tax = (self.tax + 1) % 3;
                self.gold += [50, 120, 260][self.tax];
            }
            hud_button(ui, &mut self.dt, t("nobles"), "demo.nobles", MarkOptions::default());
            let gold = format!("Gold {}", grouped(self.gold, &lang));
            hud_button(ui, &mut self.dt, &gold, "demo.gold", MarkOptions::default());
            ui.separator();
            let help = MarkOptions { delay: Some(0.0), ..MarkOptions::default() };
            hud_button(ui, &mut self.dt, " ? ", "deeptip.about", help);
            let mut chosen = self.lang.clone();
            egui::ComboBox::from_id_salt("lang")
                .selected_text(if chosen == "de" { "Deutsch" } else { "English" })
                .show_ui(ui, |ui| {
                    ui.selectable_value(&mut chosen, "de".to_owned(), "Deutsch");
                    ui.selectable_value(&mut chosen, "en".to_owned(), "English");
                });
            if chosen != self.lang {
                self.dt.set_locale(&chosen);
                self.lang = chosen;
            }
            let before = self.theme;
            egui::ComboBox::from_id_salt("theme")
                .selected_text(match self.theme {
                    egui::ThemePreference::Dark => "dark",
                    egui::ThemePreference::Light => "light",
                    egui::ThemePreference::System => "auto",
                })
                .show_ui(ui, |ui| {
                    ui.selectable_value(&mut self.theme, egui::ThemePreference::System, "auto");
                    ui.selectable_value(&mut self.theme, egui::ThemePreference::Light, "light");
                    ui.selectable_value(&mut self.theme, egui::ThemePreference::Dark, "dark");
                })
                .response
                .on_hover_text(t("theme"));
            if self.theme != before {
                ui.ctx().set_theme(self.theme);
            }
        });
    }

    fn body(&mut self, ui: &mut egui::Ui) {
        let lang = self.lang.clone();
        let t = |k| text(&lang, k);
        egui::ScrollArea::vertical().show(ui, |ui| {
            ui.set_max_width(760.0);
            egui::Frame::group(ui.style()).show(ui, |ui| {
                ui.heading(t("try"));
                self.dt.text(ui, t("intro"));
                ui.add_space(4.0);
                ui.scope(|ui| {
                    ui.style_mut().visuals.override_text_color = Some(ui.visuals().weak_text_color());
                    self.dt.text(ui, t("controls"));
                });
            });
            ui.add_space(12.0);
            egui::Frame::group(ui.style()).show(ui, |ui| {
                ui.heading(t("settings"));
                let o = &mut self.dt.engine.options;
                ui.add(egui::Slider::new(&mut o.delay, 0.0..=3000.0).step_by(100.0).suffix(" ms").text(t("delay")));
                ui.horizontal(|ui| {
                    egui::ComboBox::from_label(t("lock"))
                        .selected_text(if o.lock_after <= 0.0 {
                            t("off").to_owned()
                        } else {
                            format!("{} s", o.lock_after / 1000.0)
                        })
                        .show_ui(ui, |ui| {
                            ui.selectable_value(&mut o.lock_after, 0.0, t("off"));
                            ui.selectable_value(&mut o.lock_after, 1500.0, "1.5 s");
                            ui.selectable_value(&mut o.lock_after, 3000.0, "3 s");
                        });
                    ui.add_space(12.0);
                    egui::ComboBox::from_label(t("outside"))
                        .selected_text(format!("{:?}", o.outside_click_closes).to_lowercase())
                        .show_ui(ui, |ui| {
                            ui.selectable_value(&mut o.outside_click_closes, OutsideClick::Touch, "touch");
                            ui.selectable_value(&mut o.outside_click_closes, OutsideClick::Always, "always");
                            ui.selectable_value(&mut o.outside_click_closes, OutsideClick::Never, "never");
                        });
                });
                ui.horizontal(|ui| {
                    ui.checkbox(&mut o.close_buttons, t("closeButtons"));
                    ui.checkbox(&mut o.pin_button, t("pinButton"));
                    ui.checkbox(&mut o.hints, t("hints"));
                });
            });
            ui.add_space(12.0);
            egui::Frame::group(ui.style()).show(ui, |ui| {
                ui.heading(t("index"));
                self.dt.index(ui, &mut self.query);
            });
            ui.add_space(12.0);
            egui::Frame::group(ui.style()).show(ui, |ui| {
                ui.heading(t("events"));
                for line in self.log.iter().rev().take(12) {
                    ui.monospace(line);
                }
            });
            ui.add_space(60.0);
        });
    }

    /// Buttons in the four corners: placement at the screen edge.
    fn corners(&mut self, ctx: &egui::Context) {
        let lang = self.lang.clone();
        let corners = [
            ("tl", egui::Align2::LEFT_TOP, egui::vec2(12.0, 64.0), "province", "demo.province"),
            ("tr", egui::Align2::RIGHT_TOP, egui::vec2(-12.0, 64.0), "prestige", "demo.prestige"),
            ("bl", egui::Align2::LEFT_BOTTOM, egui::vec2(12.0, -12.0), "revolt", "demo.revolt"),
            ("br", egui::Align2::RIGHT_BOTTOM, egui::vec2(-12.0, -12.0), "unrest", "demo.unrest"),
        ];
        for (id, align, offset, label, key) in corners {
            // the bottom corners prefer the top side (own order, like data-deeptip-place on the web)
            let place = if id.starts_with('b') { vec![Side::Top, Side::Right, Side::Left] } else { Vec::new() };
            egui::Area::new(egui::Id::unique(("deeptip-corner", id))).anchor(align, offset).show(ctx, |ui| {
                hud_button(ui, &mut self.dt, text(&lang, label), key, MarkOptions { place, ..MarkOptions::default() });
            });
        }
    }
}

impl eframe::App for Hud {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        // Esc and F6 reach DeepTip before the widgets while windows are open
        self.dt.handle_keys(&ctx);
        self.dt.set_value("stability", signed(self.stability));
        self.dt.set_value("gold", grouped(self.gold, &self.lang));

        egui::Panel::top("hud").show(ui, |ui| self.top_bar(ui));
        egui::CentralPanel::default().show(ui, |ui| self.body(ui));
        self.corners(&ctx);
        self.dt.show(&ctx);

        for e in self.dt.take_events() {
            self.log.push(match e {
                Event::Opened { key, .. } => format!("open   {key}"),
                Event::Closed { key, .. } => format!("close  {key}"),
                Event::Pinned { key, .. } => format!("pin    {key}"),
                Event::Unpinned { key, .. } => format!("unpin  {key}"),
            });
        }
        if let Some(after) = self.exit_after {
            let elapsed = self.started.elapsed();
            if elapsed >= after {
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            } else {
                ctx.request_repaint_after(after - elapsed);
            }
        }
    }
}

fn main() -> eframe::Result {
    let lang = std::env::var("DEEPTIP_LANG")
        .ok()
        .or_else(|| std::env::var("LANG").ok().map(|l| l.chars().take(2).collect()))
        .filter(|l| l == "en")
        .unwrap_or_else(|| "de".to_owned());
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("DeepTip · egui")
            .with_inner_size([1000.0, 720.0])
            .with_min_inner_size([360.0, 480.0]),
        ..Default::default()
    };
    eframe::run_native("DeepTip HUD", options, Box::new(move |_cc| Ok(Box::new(Hud::new(&lang)))))
}
