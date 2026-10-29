# DeepTip (Deutsch)

[![Release](https://img.shields.io/github/v/release/gorduan/DeepTip)](https://github.com/gorduan/DeepTip/releases) [![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-blue)](LICENSE) [![Agent Skill](https://img.shields.io/badge/KI--Agenten-Agent%20Skill-8A2BE2)](skill)

![Drei DeepTip-Fenster nebeneinander: „Stability“ erklärt einen Wert und verweist auf „unrest“, „Unrest“ öffnet daneben und verweist auf „revolt“, „Revolt“ ist noch eine Vorschau](docs/images/deeptip-windows.png)

**DeepTip lässt jede Bedienoberfläche sich selbst erklären, so tief, wie man will.** Maus auf einem Knopf, einem Wert oder einem Wort ruhen lassen, und ein kleines Fenster erklärt es. Markierte Wörter in diesem Fenster haben eigene Erklärungen: Maus darauf, und das nächste Fenster öffnet sich daneben; ein Klick hält es fest. Das ist das System „Tooltips in Tooltips“, mit dem die Strategiespiele von Paradox Interactive (Crusader Kings III, Victoria 3, Europa Universalis V) ihre Regeln erklären, als offenes Muster für jedes Programm, jedes Spiel und jedes Werkzeug, in jeder Sprache.

English: [README.md](README.md)

## Wofür dieses Projekt da ist

Programme und Spiele sind voller Begriffe, die voneinander abhängen: Ein Wert hängt an drei anderen, eine Regel verweist auf zwei weitere. Ein normaler Tooltip zeigt eine Zeile und verschwindet; Handbuch oder Wiki sind einen Tab-Wechsel entfernt und reißen aus dem Fluss. DeepTip bringt die ganze Erklärung dorthin, wo man ohnehin hinschaut, eine Mausbewegung nach der anderen.

| Normaler Tooltip | DeepTip |
|---|---|
| eine Zeile Text, weg, sobald sich die Maus bewegt | ein Fenster, in das man hineinfahren, lesen, festhalten und schließen kann |
| jeder Tooltip steht für sich | Begriffe darin öffnen weitere Fenster, beliebig tief |
| der Text steht im Programmcode | die Texte stehen in einer JSON-Datei je Sprache, wie Übersetzungen |
| nur Maus | Maus, Touch, Tastatur, Controller und Bildschirmleser |

Gemacht für alles, wo Menschen vielen zusammenhängenden Begriffen begegnen: **Spiele und Mods** (Werte, Regeln, Gegenstände), **Fachprogramme** (Einstellungen, Einheiten, Formeln), **Dashboards** (was eine Zahl bedeutet und woher sie kommt), **Einstellungsseiten** und **Einstieg ohne Tutorial**.

Dieses Repo enthält alles, um das Muster zu nutzen:

1. **Das Muster selbst**, genau aufgeschrieben: die [Spezifikation](SPEC.md) und jeder Ablauf als sprachneutraler Pseudocode in [docs/algorithms.md](docs/algorithms.md).
2. **Fertigen Code** in HTML, CSS, JavaScript und Rust.
3. **Eine genaue Bauanleitung für jedes andere Framework**, Schritt für Schritt, mit den schon gefundenen Fallen.
4. **Einen KI-Skill**, der das alles deinem Coding-Agenten beibringt. So kommt DeepTip in jedes Projekt, auch in ein Framework ohne Anleitung.
5. **Werkzeuge:** JSON-Schema und Prüfer für die Erklärungsdateien und gemeinsame Testfälle, die beweisen, dass eine Umsetzung sich wie die Referenz verhält.

## Funktioniert mit

**Fett** = fertiger Code zum Kopieren. Die anderen haben eine genaue Schritt-für-Schritt-Anleitung. Jeder Eintrag führt zu seinem Ordner, jeder Ordner ist auch ein eigener Download im [Release](https://github.com/gorduan/DeepTip/releases).

| Bereich | Frameworks |
|---|---|
| **Web** | **[HTML + CSS + JavaScript](frameworks/web)** (Referenz) · [TypeScript](frameworks/typescript) · [React](frameworks/react) · [Vue](frameworks/vue) · [Svelte](frameworks/svelte) · [Blazor](frameworks/blazor) |
| **Desktop** | **[Rust (egui)](frameworks/rust-egui)** · [Avalonia](frameworks/avalonia) · [Python (PySide6 / Qt)](frameworks/python-pyside6) · [Java (Swing)](frameworks/java-swing) · [Kotlin (Compose Desktop)](frameworks/kotlin-compose) · [C++ (Dear ImGui)](frameworks/cpp-imgui) · [Swift (SwiftUI)](frameworks/swift-swiftui) · [Go (Gio)](frameworks/go-gio) |
| **Spiele, Engines, Mods** | **[RPG Maker MZ](frameworks/rpgmaker-mz)** · [Unity](frameworks/unity) · [Unreal Engine 5](frameworks/cpp-unreal) · [Godot 4](frameworks/godot) · [Valheim-Mod](frameworks/valheim) ([fertige Mod](https://github.com/gorduan/Valheim_DeepTip)) |
| **Alles andere** | jede Sprache, Engine oder jedes Toolkit: Dein KI-Agent baut es mit dem Skill aus [docs/algorithms.md](docs/algorithms.md) und prüft es an den gemeinsamen Testfällen |

Alle Umsetzungen lesen dieselben Erklärungsdateien: Ein Glossar reicht für Web-App, Desktop-Werkzeug und Spiel.

## Überall einbauen: der DeepTip-Skill

Der [DeepTip-Skill](skill) bringt einem KI-Coding-Agenten das ganze Muster bei. Einmal installieren, dann in jedem Projekt und in jeder Sprache sagen: *„Bau DeepTip in dieses Projekt ein.“*

```mermaid
flowchart LR
  S["DeepTip-Skill"] --> A["Dein KI-Agent"]
  A --> D{"Welches Framework?"}
  D -->|"fertiger Code"| C["kopiert die Laufzeit<br/>(Web, Rust, RPG Maker)"]
  D -->|"Anleitung"| G["folgt der genauen Anleitung"]
  D -->|"nicht dabei"| N["baut es aus den Algorithmen<br/>und den Testfällen"]
  C --> P["DeepTip im Projekt,<br/>Texte geschrieben, vom Prüfer geprüft"]
  G --> P
  N --> P
```

**Was der Agent lernt:**
- was DeepTip ist und wie es sich verhalten muss: Zeiten, Platzierung, Tastatur, Touch, Controller, Barrierefreiheit;
- das Format der Erklärungsdateien;
- drei Abläufe: DeepTip einbauen, Erklärungen schreiben und prüfen, DeepTip dort bauen, wo es keine Anleitung gibt;
- jede Framework-Anleitung und eine Abnahme-Liste.

Der Skill trägt alle Anleitungen, Spezifikation, Algorithmen, Web-Laufzeit, Testfälle und Prüfer in seinem eigenen Ordner, er funktioniert also auch ohne Internet.

**Welche Agenten:** Der Skill nutzt das offene Format [Agent Skills](https://agentskills.io/specification). Das lesen **Claude Code, Claude (claude.ai und Desktop-App), OpenAI Codex, GitHub Copilot, Cursor und Gemini CLI**.

```bash
git clone --depth 1 https://github.com/gorduan/DeepTip
mkdir -p ~/.claude/skills ~/.agents/skills
cp -r DeepTip/skill/deeptip ~/.claude/skills/   # Claude Code
cp -r DeepTip/skill/deeptip ~/.agents/skills/   # Codex, GitHub Copilot, Cursor, Gemini CLI
```

Für claude.ai `DeepTip-skill-<Version>.zip` aus den [Releases](https://github.com/gorduan/DeepTip/releases) unter *Customize → Skills* hochladen. Alle Agenten, Ordner und Quellen: [skill/README.md](skill/README.md).

## Ohne Agenten nutzen

- **Webseite oder Web-App:** das Beispiel aus der [englischen README](README.md#a-website-or-web-app-three-steps-no-build) als Datei speichern und öffnen. Kurz:
  1. `deeptip.css` und `deeptip.js` vom CDN `https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/frameworks/web/` laden.
  2. Die Erklärungen in `deeptip/de.json` schreiben.
  3. Elemente mit `data-deeptip="schlüssel"` markieren.

  Alle Optionen: [frameworks/web/README.md](frameworks/web/README.md).
- **Jedes andere Framework:** seinen Ordner unter [Funktioniert mit](#funktioniert-mit) öffnen oder `DeepTip-<framework>-<Version>.zip` aus den [Releases](https://github.com/gorduan/DeepTip/releases) laden. Jede Anleitung beginnt mit dem, was zu kopieren oder zu bauen ist, und endet mit einer Prüfliste.

## Erklärungen schreiben

Eine JSON-Datei je Sprache. Die Schlüssel haben Punkte und sind in jeder Sprache gleich. Der Text nutzt ein kleines Markup, nie HTML:
- `[[schlüssel]]` und `[[schlüssel|eigener Text]]` für Verweise;
- `**fett**`, `*kursiv*`, `` `code` ``;
- `{wert}` für Live-Werte;
- `- ` für Listen, eine Leerzeile für einen neuen Absatz.

`short` bleibt eine Zeile (höchstens 140 Zeichen), `body` hat 2–5 Sätze. Vor jedem Release prüfen:

```bash
node tools/deeptip-check.mjs --base de deeptip/de.json deeptip/en.json --scan src
```

Das ganze Format: [SPEC.md §2](SPEC.md). Die Tabelle aller Frameworks mit Sprache, Stufe und Art steht in der [englischen README](README.md#all-frameworks-in-detail).

## Für KI-Agenten und Sprachmodelle

- `skill/`: der Agent Skill mit Installationshinweisen für jeden Agenten.
- `llms.txt`: Einstieg für Sprachmodelle.
- `AGENTS.md`: Anweisungen für Coding-Agenten am Repo.
- `docs/prompt.md`: Briefing zum Einfügen in jeden Chat.

## Werkzeuge

```bash
npm test          # Referenz gegen test/cases, Skill-Kopie aktuell
npm run check     # Glossare prüfen
npm run demo      # dann http://localhost:5560/frameworks/web/example/
npm run package   # ein Zip je Framework und den Skill nach dist/
npm run skill     # skill/deeptip/references nach Änderungen an den Originalen auffrischen
```

Lizenz: MIT. Gorduan Community (GC): frei nutzen, ändern, hochladen.
