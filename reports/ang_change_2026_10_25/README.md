# Changing Ang during offline sehaj paath

The user supplied `BaniGuru_AutoPilot_2026-10-25_21-10-03_574.mp3`.
The complete decoded recording is **237.06 seconds**. It moves from Ang 115/116
to Ang 127. No human transcript or timed expected-line labels were supplied,
so **WER, CER and pankti accuracy are unscored**. The recording and full raw ASR
report remain outside the repository. Input hash and measurements are in
[diagnostics.json](diagnostics.json).

## Recording replay

Both versions use the same production streaming-model/KenLM ASR events,
with the kirtan flag off and `additional_assets/bani.db`.

| Continuity diagnostic | Previous commit | Updated code |
| --- | ---: | ---: |
| Display transitions | 52 | 68 |
| Shabads visited | 4 | 5 |
| Broad searches | 38 | 11 |
| Last display transition | 214.206 s | 236.306 s |
| Last Ang reached | 116 | 127 |

The previous forward-only recovery corridor could not reach another Ang.
It continued matching occasional shared words in the old region. The updated
replay confirms Ang 127 at **181.566 seconds**, then continues to the final
pankti in the recording. [transitions.json](transitions.json) contains the full
timeline. These results establish recovery and continuity, not perfect alignment;
noisy ASR can still delay confirmation.

Local paath tracking retains its nearby canonical order. After twelve seconds
without strong matching evidence, a different location in the same source can
be reacquired in either direction. Confirmation requires separate audio updates
and either two non-overlapping ordered verse anchors or a longer distinctive
phrase held across updates. A lone short common phrase or heading cannot
establish a distant move. An explicitly loaded Bani can be left when a new Ang
outside it is confirmed.

Weak two-word matches no longer reset the strong-evidence clock indefinitely.
During reacquisition, up to three promising Shabads are loaded to recover verse
neighbors omitted by the global shortlist. This lets the matcher verify a
sequence rather than staying stuck because only its final verse was retrieved.
Broad searches remain coalesced, not issued per displayed pankti.

The ASR pass processed the recording in 149.17 seconds (RTF about 0.629), on four
Xeon cores with a 16 GiB address-space cap. This is not an Intel i5 emulation.
Decoder settings were unchanged.

## Settings and recording

- Auto Search is always enabled while Auto Pilot runs. Its UI toggle and stored
  disabling preference are removed; existing `autoSearch: false` settings cannot
  disable acquisition.
- Kirtan is shown only with Offline enabled. Offline/Kirtan share a group with
  spacing before the remaining automation controls.
- Recording appears immediately after Audio Stream, persists across restarts,
  and defaults on to preserve the previous behavior. It can switch live without
  restarting ASR, including when the preference changes while the model starts.
- A shared pipeline converts microphone audio once to 16 kHz mono and supplies
  that same signal to ASR and the optional recorder. Files use 16-bit PCM WAV,
  avoiding an MP3 encoder and its dependency/CPU cost. At about 32 KB/s this is
  roughly twelve times smaller than the previous 48 kHz stereo float WAV.
- Each recording has a timestamped name under `Music/BaniGuru`. Turning recording
  off finalizes the file; turning it back on starts another file. Stopping Auto
  Pilot closes the normalized feed before draining/finalizing recording and ASR.
- App-named WAV/MP3 recordings older than seven days are pruned at app startup,
  daily while open, and when starting a recording. Active recordings, symlinks,
  directories and unrelated files are preserved. Cleanup uses file modification
  time. No existing user recordings were deleted during these tests.

For the complete input, normalization and PCM writing took **0.105 seconds**
after decoding, producing a **7,556,332-byte WAV**. This is a file-processing
benchmark, not a real-microphone scheduling or end-to-end latency measurement.

## Verification

The final frontend run passed **79 tests**, including complete ASR-event replays
of this recording, the earlier 9-minute-32-second upload, and the full AKJ part-2
recording. AKJ still reaches **250/251 mapped sections**; the earlier upload also
continues to its end. `npm run build` passed.

Three native recording tests cover normalized-sample equality within PCM
quantization, mono/rate/bit-depth and size, live toggling with uninterrupted ASR
bus audio, unique files, and seven-day retention protections. The opt-in full
recording conversion benchmark also passed.

Chromium checks use the real React providers, `useSpeech`, search and pankti
hooks, production reader and SQLite queries, with a mock Tauri IPC adapter.
They verify Offline-only Kirtan visibility, control order and spacing, migration
of a disabled Auto Search preference, live recording changes during startup,
no ASR restart for recording changes, and forward/backward Ang reacquisition.
See [ui.json](ui.json). A physical microphone and a live Soniox connection were
not exercised.
