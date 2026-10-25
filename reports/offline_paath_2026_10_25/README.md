# Offline sehaj paath: AutoPilot recording, 25 October 2026

The user supplied `BaniGuru_AutoPilot_2026-10-25_19-51-53_914.mp3`.
The complete decoded recording is **571.67 seconds**. It has no accompanying
human transcript or timed pankti labels. Results below measure decoding and
tracking continuity; **WER, CER and pankti accuracy are unscored**.
The input hash and machine measurements are in [diagnostics.json](diagnostics.json).
The recording itself is not added to the repository.

## Reproduction and result

The shipped streaming model and KenLM decoder ran in sehaj paath mode, with
340 ms refresh, on four Xeon CPU cores under a 16 GiB address-space cap. This
is not an Intel i5 emulation. Processing took 333.52 seconds (RTF 0.5834), with
a 338.54 ms 95th-percentile update and about 0.90 GiB peak resident memory.
ASR decoding settings and hypotheses were not changed by these tracking fixes.

The same 1,683 audio updates (1,074 final words) were replayed with the previous
committed matcher and the updated matcher, using `additional_assets/bani.db`.

| Diagnostic | Previous code | Updated code |
| --- | ---: | ---: |
| First selection | 4.766 s | 5.106 s |
| Display transitions | 10 | 182 |
| Distinct Shabads reached | 2 | 13 |
| Last display transition | 23.806 s | 571.670 s |
| Last Ang reached | 179 | 182 |
| Broad search calls | 7 | 11 |

The original permanent stall is at `ZD6B`, “ਜਿਉ ਬੋਹਿਥੁ ਭੈ ਸਾਗਰ ਮਾਹਿ”.
The updated replay continues to `6M78`, “ਜਾ ਕੈ ਵਸਿ ਖਾਨ ਸੁਲਤਾਨ”, at the end.
All post-acquisition changes in this replay use canonical local progression;
the largest confirmed forward correction is eight lines, with no backward
corrections. [transitions.json](transitions.json) contains the full timeline.
The added initial 340 ms provides another audio observation before selection.

Reaching the end does not establish perfect alignment. Some temporary holds
remain when ASR is noisy: the largest transition gap is 25.84 seconds, from
296.826 to 322.666 seconds. Without human time labels this gap cannot be split
reliably into speaking time, silence and tracking delay. This change prevents
the permanent stall; it does not correct the recording's recognition errors.

The earlier full AKJ part-2 ASR-event regression still reaches **250/251 mapped
reference sections**, with two broad searches and maximum local movement of
two lines forward or backward.

## Changes

- Normal paath matching keeps its nearby sequential corridor. After four
  seconds without fresh support, recovery examines at most twelve forward
  panktis, requiring three distinct exact normalized words and confirmation
  on separate audio updates. Old words cannot be reused to trigger a jump.
- Three canonical successor Shabads are prefetched on Shabad changes. A
  recovery across a missed Shabad loads the correct successor and replenishes
  the prefetch window. There is no SQL query per matched pankti.
- If local support remains absent for ten seconds and new words have arrived,
  broader recovery is allowed within the current or next Ang, at most sixty
  source lines ahead. It stays in the same source and preserves an explicitly
  selected Bani. New selections need repeated evidence; ambiguous phrases do
  not auto-select a random Shabad.
- Returning to Search starts acquisition independently of the displayed
  Shabad. Database readiness and failed lookups can retry unchanged speech.
  In-flight search is serialized rather than cancelled by every audio update;
  stale work cannot override a manual selection or recovered cursor.
- Broad queries are coalesced to at most approximately one per second. Search
  choices are held for two seconds, require another audio update to replace a
  different leading Shabad, and retain positions of still-relevant choices.
  Manual typed search is preserved.
- Ordinary paath panktis can share a row when their actual Gurmukhi font width
  and combined translation height fit. Punjabi and English meanings are joined
  with a space. Headings, stanza boundaries, and Sukhmani saloks stay separate;
  existing Sukhmani ashtpadi pairs are preserved. Four rows remain visible,
  showing up to eight panktis. Measurement does not shrink fonts to force pairs.
  Font size stays consistent per Ang; caches remain bounded to four Angs.

## Verification

`BANI_TEST_DB=additional_assets/bani.db npm test -- --run` runs the ordinary
suite. Setting `BANI_RECORDING_REPLAY` to the complete ASR report additionally
runs the file replay; the final combined run passed all **74 tests**.
`npm run build` also passed.

The recording has no reference, so the native evaluation was explicitly run
with `BANI_ASR_UNREFERENCED_REPLAY=1`; all error-rate fields remain null. Normal
reference evaluation still requires a transcript unless this opt-in is set.

Chromium checks use the production React hooks, reader and SQLite queries over
a loopback fixture adapter. They cover cold database readiness with unchanged
speech, 650 ms query latency during 340 ms audio updates, returning to Search,
local and bounded global recovery, ambiguous result stability, joined
translations, two screen sizes, constant Ang fonts, third-row scrolling,
Sukhmani saloks, and eight-pankti ashtpadi views. See [ui.json](ui.json) and
[ui-extra.json](ui-extra.json). This is not a microphone or Tauri WebView test.
