# DeepTip (Deutsch)

English: [README.md](README.md)

> **DeepTip** ist ein Gestaltungsmuster für Bedienoberflächen: Erklärfenster mit Tiefe. Maus auf einem Element ruhen lassen → ein Fenster erklärt es. Markierte Begriffe darin öffnen weitere Fenster, ein Klick hält sie fest, und in festgehaltenen Fenstern geht es beliebig tief weiter, so wie die Paradox-Spiele (Crusader Kings III, Victoria 3, Europa Universalis V) ihre Regeln erklären. Der Inhalt sind Daten: ein JSON-Glossar je Sprache.

Andere Namen für dasselbe: DeepTooltip, 3DTooltip, DimTip, nested tooltips, Paradox-Tooltips, Tooltips in Tooltips, Erklärfenster.

Dieses Repo ist die Heimat des Musters: Spezifikation, Datenformat mit Schema und Prüfer, gemeinsame Testfälle, der Code in HTML, CSS, JavaScript und Rust und für jedes andere Framework eine genaue Bauanleitung, jedes in einem eigenen Ordner mit eigenem Download.

## Die Regeln

- **Ein Eintrag, drei Tiefen:** `title` (Name), `short` (eine Zeile), `body` (2–5 Sätze mit Verweisen).
- **Begriffe sind Verweise:** Jeder Begriff kann ein eigener Eintrag sein, nichts wird doppelt erklärt.
- **Nichts geht aus Versehen verloren:** Ein Fenster bleibt, solange die Maus darauf zufährt; Begriffe auf dem Weg dorthin ersetzen es nicht; festgehaltene Fenster schließen nur auf Wunsch.
- **Den Rückweg nie verdecken:** Ein weiteres Fenster öffnet neben dem, aus dem es kam.
- **Inhalt sind Daten:** eine JSON-Datei je Sprache, nie Erklärtext im Code.
- **Jedes Eingabegerät zählt:** Maus, Touch, Tastatur, Controller, Bildschirmleser.
- **Erst das, was die Plattform kann:** Popups, Rich Text, Fokus, dann eigener Code.

## Frameworks: ein Ordner, ein Download

Code gibt es nur in **HTML, CSS und JavaScript** (Referenz) und in **Rust**. Jedes andere Framework bekommt statt Code eine genaue Bauanleitung: welcher Baustein des Toolkits welchen Teil der Spezifikation umsetzt, in welcher Reihenfolge, mit den Fallen. Die gemeinsamen Algorithmen stehen einmal Schritt für Schritt in [docs/algorithms.md](docs/algorithms.md).

- **Code:** Web (HTML + CSS + JS, Referenz), RPG Maker MZ (JS-Plugin), Rust (egui).
- **Anleitung, Stufe 1:** TypeScript, Svelte, React, Vue, Blazor (alle auf der Web-Laufzeit), Avalonia, Unity, Valheim (die Mod selbst: [gorduan/Valheim_DeepTip](https://github.com/gorduan/Valheim_DeepTip)), Godot, Python (PySide6).
- **Anleitung, Stufe 2:** Java (Swing), Kotlin (Compose), C++ (Dear ImGui), C++ (Unreal), Swift (SwiftUI), Go (Gio).

Jedes liegt in `frameworks/<name>/` mit README und `deeptip.json`; Code-Ordner haben ein Beispiel (gemeinsames Beispiel-Glossar `glossary/example/`) und Tests gegen `test/cases/`, jede Anleitung sagt, wie man diese Fälle in ihrer Sprache prüft. Downloads: `DeepTip-<framework>-<version>.zip` (`npm run package`), jeweils mit SPEC, Algorithmen, Schema, Glossaren und Testfällen.

## Skill für KI-Agenten

[skill/deeptip](skill/deeptip) ist ein [Agent Skill](https://agentskills.io/specification) im offenen Format, das Claude Code, Claude, OpenAI Codex, GitHub Copilot, Cursor und Gemini CLI lesen. Einmal installiert, bringt er dem Agenten DeepTip bei, für jedes Programm und jede Sprache:
- die Regeln und das Verhalten;
- das Glossar-Format;
- drei Abläufe: DeepTip in ein Projekt einbauen, Glossare schreiben und prüfen, DeepTip dort bauen, wo es noch keine Anleitung gibt;
- alle 19 Framework-Anleitungen und eine Abnahme-Liste.

Der Ordner `references/` enthält Spezifikation, Algorithmen, Anleitungen, Web-Laufzeit, Glossare, Testfälle und Prüfer. Der Skill funktioniert also auch ohne Internet.

Installieren: den Ordner `skill/deeptip` nach `~/.claude/skills/` (Claude Code) und `~/.agents/skills/` (Codex, Copilot, Cursor, Gemini CLI) kopieren. Für claude.ai `DeepTip-skill-<version>.zip` aus den Releases hochladen. Alle Wege: [skill/README.md](skill/README.md).

## Für Sprachmodelle und Agenten

`skill/deeptip/SKILL.md` (der Skill oben), `llms.txt` (Einstieg für Sprachmodelle), `AGENTS.md` (Anweisungen für Coding-Agenten), `docs/prompt.md` (Briefing zum Einfügen in jeden Chat).

## Werkzeuge

```bash
npm test          # Referenz gegen test/cases
npm run check     # Glossare prüfen
npm run demo      # dann http://localhost:5560/frameworks/web/example/
npm run package   # ein Zip je Framework und den Skill nach dist/
npm run skill     # skill/deeptip/references nach Änderungen an den Originalen auffrischen
```

Lizenz: MIT. Gorduan Community (GC): frei nutzen, ändern, hochladen.
