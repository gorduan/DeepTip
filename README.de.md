# DeepTip (Deutsch)

English: [README.md](README.md)

**Erklärfenster mit Tiefe** – Tooltips in Tooltips wie in den Paradox-Spielen (Crusader Kings III, Victoria 3,
Europa Universalis V). Maus auf einem Bedienelement ruhen lassen → nach einstellbarer Zeit erklärt ein Fenster
das Element. Markierte Begriffe darin öffnen beim Drüberfahren weitere Fenster, ein Klick hält sie fest, und in
festgehaltenen Fenstern geht es beliebig tief weiter. Mit Touch (lange drücken), Tastatur (F1, Esc, F6) und
Controller (Y, A, B, LB/RB).

Andere Namen, die dasselbe meinen: DeepTooltip, 3DTooltip, DimTip, nested tooltips, Paradox-Tooltips.

| Datei | Inhalt |
|---|---|
| [SPEC.md](SPEC.md) | verbindliche, laufzeitneutrale Beschreibung: Datenformat, Verhalten, Platzierung, Steuerung |
| [CONCEPT.md](CONCEPT.md) | Recherche (Paradox) und die Entscheidungen dahinter |
| `web/deeptip.js`, `web/deeptip.css` | Web-Umsetzung ohne Abhängigkeiten (jede Webseite, Svelte, React, Tauri, Electron) |
| `glossary/core/de.json`, `en.json` | gemeinsames Kern-Glossar (Hardware, System, KI-Grundbegriffe, DeepTip-Hilfe) |
| `schema/deeptip.schema.json` | JSON-Schema für Glossar-Dateien (Vervollständigung in VS Code) |
| `tools/deeptip-check.mjs` | Prüfwerkzeug: kaputte Links, fehlende Übersetzungen, zu lange Texte, unbenutzte Einträge |
| `tools/deeptip-sync.mjs` | kopiert Laufzeit + Kern-Glossar in ein Projekt |
| `demo/` | Beispielseite (de/en, alle Einstellungen, Enzyklopädie) |
| `skill/SKILL.md` | Skill für Claude Code, damit ein Assistent DeepTip in ein Projekt einbauen kann |

## Schnellstart (Web)

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/web/deeptip.css" />
<button data-deeptip="app.gamemode">Spielmodus</button>
<script type="module">
  import { DeepTip } from "https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/web/deeptip.js";
  DeepTip.init({
    locale: "de",
    fallback: ["en"],
    delay: 3000, // Ruhezeit bis zum ersten Fenster (0 = sofort)
    sources: ["deeptip/core/{locale}.json", "deeptip/{locale}.json"],
  });
</script>
```

Glossar-Eintrag (`deeptip/de.json`):

```json
{
  "app.gamemode": {
    "title": "Spielmodus",
    "short": "Gibt den PC fürs Spielen frei.",
    "body": "Stoppt schwere Dienste wie [[ai.comfyui]] und leert den [[hw.vram|Grafikspeicher]]."
  }
}
```

`[[schlüssel]]` verlinkt mit dem Titel des Ziels, `[[schlüssel|eigener Text]]` mit eigenem Text. Außerdem
`**fett**`, `*kursiv*`, `` `code` ``, `{live_wert}`, Listen mit `- `. Nie HTML.

## Werkzeuge

```bash
npm test
```

```bash
node tools/deeptip-check.mjs --base de glossary/core/de.json mein-projekt/de.json --scan mein-projekt/src
```

```bash
node tools/deeptip-sync.mjs "pfad/zum/projekt/src/deeptip"
```

Demo: `npm run demo`, dann `http://localhost:5560/demo/`.

## Laufzeiten

Web (`web/`, 1.0), Valheim (`valheim/`, BepInEx-Mod „DeepTip“ auf Thunderstore, in Entwicklung), geplant: Godot 4,
.NET. Alle nutzen dieselben JSON-Dateien und dasselbe Prüfwerkzeug (SPEC §9).
