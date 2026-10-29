# DeepTip — Konzept (30.09.2026)

> **Status:** umgesetzt als DeepTip 1.0 – verbindlich ist jetzt [SPEC.md](SPEC.md). Dieses Dokument bleibt als
> Recherche und Begründung. Arbeitsname war „3DTooltip“; gewählt wurde **DeepTip** (kurz, eindeutig, kein
> Missverständnis mit 3D-Grafik).

> **DeepTip** = Tooltips mit **Tiefe**: Erklärungen, deren markierte Begriffe weitere Erklärungen öffnen,
> beliebig tief, festpinnbar.
> Eigenständiges Projekt: eine Idee, ein Datenformat, eine Verhaltensbeschreibung — umsetzbar in Webseiten,
> Svelte/Tauri-Apps, Godot, .NET/OrchardCore und jeder anderen Laufzeit. Erste Integration: AI-Head.

---

## 1. Recherche: wie Paradox es macht

| Spiel | Name / Mechanik | Wichtige Details |
|---|---|---|
| **Crusader Kings III** (2020) | „Tooltips in Tooltips“, blau markierte **Game Concepts** | Zwei Modi: **Timer Lock** (Standard, der Tooltip rastet nach ein bis zwei Sekunden ein, dann kann die Maus hinein) und **Action Lock** (mittlere Maustaste pinnt/löst; ohne Klick keine verschachtelten Tooltips). Dieselben Konzepttexte stehen zusätzlich in einer **Enzyklopädie**. Action Lock ist für Erfahrene gedacht: Hilfe nur noch auf Wunsch. |
| **Victoria 3** (2022) | übernimmt das CK3-System | Bekanntes Problem: Beim Weg der Maus in den Tooltip öffnen sich unterwegs andere Tooltips und schließen den gewünschten. Dev Diary 74 hat deshalb das Layout geändert, damit der Weg in den verschachtelten Tooltip frei ist. Grundsatz: Wichtiges gehört **weiter oben** in die Hierarchie, tiefe Ebenen nur für Hintergrundwissen. |
| **Europa Universalis V** (2025) | vier Modi: **Mouse Tendency**, Timer, Action Lock, Beide | Neu ist *Mouse Tendency*: Der Tooltip bleibt offen, wenn die Maus sich **auf ihn zubewegt** (Absichtserkennung). Stillhalten der Maus lässt ihn einrasten. |
| Kritik (UX-Analyse, Forum) | — | Ein Pixel außerhalb, und alles schließt sich; unklare Tiefe (typisch 2–3 Ebenen); Touch/Barrierefreiheit ungelöst; Wunsch, dass ein gepinnter Tooltip kurz das Öffnen anderer verhindert. |
| Verwandte Muster | Obsidian „Nested Popovers“, Wikipedia-Seitenvorschau | Inhalte als Notizen mit `[[Wiki-Links]]`; Vorschau des verlinkten Eintrags beim Hovern. |

Quellen: CK3 Dev Diary #16 (Paradox Forum / Steam), Victoria 3 Dev Diary #74 (paradoxinteractive.com),
PCGamesN „Victoria 3 will use Crusader Kings 3's tooltip system“, Steam-Diskussion „EU5 – Question on Tooltip
Setting“, Philip Ardeljan „Tooltips in tooltips“, Paradox-Forum „Locking a tooltip should prevent other tooltips
from opening for a brief moment“, Obsidian-Forum „Nested Popovers“.

## 2. Deine Vorgaben (29./30.09.)

1. Inhalte als **JSON wie Übersetzungsdateien**; Texte enthalten Schlüsselwörter, die auf weitere Einträge verweisen — beliebig tief; **muss mit Übersetzungen funktionieren**.
2. **Überall** nutzbar (Webseiten, Programme, Spiele). Der Begriff muss reichen, damit Claude in jedem Projekt sofort weiß, was gemeint ist, und es im jeweiligen Kontext umsetzt.
3. Verzögerung **nur für das erste Fenster** (AI-Head: 3 s), Links öffnen sofort; die Verzögerung ist pro Projekt einstellbar (auch „sofort“).
4. Neue Fenster erscheinen **neben dem vorherigen**: zuerst **links**, dann **rechts**, **oben**, **unten** — je nachdem, wo bis zum Bildschirmrand Platz ist. Ein Fenster darf das **vorherige nicht überdecken**, ältere schon. **X-Knöpfe** erlaubt, per Konfiguration abschaltbar.
5. Volle **Touch- und Konsolensteuerung** (z. B. langes Drücken statt Hovern).

## 3. Verbesserungsvorschläge

### A. Inhalte verwalten

1. **Ein Eintrag, drei Tiefen** (Lehre aus Victoria 3): `short` = die eine Zeile beim sofortigen Hovern (ersetzt die heutigen einfachen Tooltips), `body` = 2–5 Sätze mit Links, alles Weitere steckt in den verlinkten Einträgen. Ein Prüfwerkzeug warnt, wenn `short` zu lang ist.
2. **Format wie übliche Übersetzungsdateien**, je Sprache eine Datei, Schlüssel mit Punkten gegliedert:
   ```json
   // de.json
   {
     "aihead.gamemode": {
       "title": "Spielmodus",
       "short": "Gibt den PC fürs Spielen frei.",
       "body": "Stoppt schwere Dienste wie [[aihead.comfyui]] und leert den [[hw.vram|Grafikspeicher]]. Ein zweiter Klick startet sie wieder.",
       "aliases": ["Game Mode"]
     }
   }
   ```
   Link-Syntax `[[schlüssel]]` (zeigt den Titel des Ziels) oder `[[schlüssel|eigener Text]]` — der sichtbare Text steht in derselben Sprachdatei und wird mitübersetzt, der Schlüssel bleibt sprachneutral. Kompatibel mit i18next, Crowdin, Weblate und `.po`-Workflows (als Namensraum in bestehenden Übersetzungsdateien möglich).
3. **Schichten statt Kopien:** ein gemeinsames **Kern-Glossar** (z. B. `hw.vram`, `sys.commit`, `ai.lora`), das jedes Projekt erbt, plus ein **Projekt-Glossar**, das ergänzt oder überschreibt. Ein Begriff wird einmal gepflegt und überall verwendet.
4. **Sprach-Fallback:** fehlt ein Text in der gewählten Sprache, kommt die Rückfallsprache mit einem kleinen Hinweis — nie ein leeres Fenster.
5. **Prüfwerkzeug (CLI)**, das vor jedem Build läuft: kaputte Links, fehlende Übersetzungen, verwaiste Einträge (nirgends verlinkt), zu lange Texte, Einträge ohne `short`. Ausgabe als Liste, optional als Fehler im CI.
6. **Enzyklopädie-Seite automatisch** (wie in CK3): alle Einträge durchsuchbar, mit Rückverweisen („wird erklärt in …“). Dieselben Daten, kein zweiter Text.
7. **Live-Werte** in Texten: `{vram_frei}` o. ä. wird zur Laufzeit gefüllt (Paradox zeigt aktuelle Zahlen direkt im Tooltip). Optional.
8. **Sichere Formatierung** statt HTML: **fett**, *kursiv*, Listen, `code`, Icons (`:icon-name:`). Das lässt sich in jeder Laufzeit darstellen (HTML, Godot-BBCode, WPF-Inlines) und ist sicher gegen eingeschleusten Code.
9. **JSON-Schema** für die Dateien, damit VS Code beim Schreiben prüft und vervollständigt.
10. **Automatisches Verlinken (optional):** Begriffe aus `title`/`aliases` werden beim ersten Vorkommen im Text automatisch verlinkt. Spart Pflegeaufwand, standardmäßig aus.

### B. Verhalten (aus Paradox’ Problemen gelernt)

1. **Weg-Toleranz:** kurzes Verlassen (≈ 300 ms) schließt nichts; bewegt sich die Maus **auf ein Fenster zu**, bleibt es offen (EU5 „Mouse Tendency“). Das löst das Victoria-3-Problem, dass sich unterwegs andere Tooltips öffnen.
2. **Während man sich in ein Fenster hineinbewegt**, öffnen andere Elemente keine neuen Tooltips.
3. **Pinnen per Klick** (deine Vorgabe) plus optional **Einrasten nach Ruhezeit** (Timer-Lock wie in CK3) mit sichtbarem Fortschritt am Fensterrand; pro Projekt wählbar.
4. **Derselbe Begriff zweimal in der Kette** öffnet kein neues Fenster, sondern hebt das vorhandene hervor.
5. **Alles schließen** mit einer Geste: Esc lange drücken bzw. B-Taste halten.
6. Gepinnte Fenster sind sichtbar anders (Rahmenfarbe + Nadel-Symbol).

### C. Steuerung

| Aktion | Maus | Touch | Tastatur | Gamepad / Konsole |
|---|---|---|---|---|
| Erstes Fenster öffnen | ruhen lassen (Verzögerung) | lange drücken (≈ 500 ms, mit Vibration) | Fokus + `?` bzw. F1 | Fokus + Y/△ („Info“) |
| Unterfenster ansehen | über Link fahren | Link antippen (öffnet gepinnt) | Tab zum Link | Steuerkreuz/Stick zum Link |
| Pinnen | Klick auf Link | ist beim Tippen immer gepinnt | Enter | A/✕ |
| Neuestes schließen | Maus weg / X | Tippen daneben / X / Zurück | Esc | B/○ |
| Alle schließen | Klick ins Leere (optional) | Wischgeste nach unten | Esc lange / Umschalt+Esc | B halten |
| Zwischen Fenstern wechseln | — | antippen | F6 | LB/RB |

Barrierefreiheit: Screenreader-Rollen (Tooltip bzw. nicht-modaler Dialog für gepinnte), Fokus bleibt im gepinnten Fenster, reduzierte Bewegung wird respektiert.

### D. Platzierung
Unterfenster nach deiner Reihenfolge **links → rechts → oben → unten** am vorherigen Fenster, ohne es zu überdecken.
**Vorschlag für das erste Fenster:** Es richtet sich nach dem auslösenden Element und nicht nach einem Fenster; für eine Kopfzeile passt **unten** besser. Voreinstellung daher: unten → oben → rechts → links, pro Projekt änderbar.
Passt nirgends ganz: die Seite mit dem meisten Platz, an den Bildschirmrand geschoben.

## 4. Projektaufbau (Vorschlag)

```
DeepTip/
  CONCEPT.md            dieses Dokument
  SPEC.md               verbindliche, laufzeitneutrale Beschreibung (Verhalten, Format, Konfiguration)
  schema/               JSON-Schema der Glossar-Dateien
  glossary/core/        gemeinsames Kern-Glossar (de, en)
  tools/                Prüfwerkzeug + Enzyklopädie-Generator
  web/                  Referenz-Umsetzung: Vanilla-JS-Modul + CSS (läuft in jeder Webseite, Svelte, Tauri)
  demo/                 Beispielseite mit de/en-Umschaltung, Maus/Touch/Tastatur/Gamepad
  godot/                Godot-Addon (wenn LandsOfOre es braucht)
  skill/SKILL.md        Claude-Skill „DeepTip“ → global installiert, damit jedes Projekt den Begriff kennt
```

**Reihenfolge:** SPEC + Schema + Prüfwerkzeug → Web-Umsetzung + Demo → AI-Head-Kopfzeile (3 s) → Skill + Gedächtnis
→ weitere Laufzeiten nach Bedarf (Godot, .NET, …), jeweils nach SPEC.
