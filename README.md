# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/acaiyaya/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/acaiyaya/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0. `solve.js` exports the same
`run(input)` and returns csv-reader's own answer — `{columns, rows, errors}`, every
broken-row error included — for every input, but reads the text in slices instead of
a character at a time: the common field (unquoted, or quoted with no escapes and no
CR) is one scan over char codes plus one `slice`, and only the rare broken shapes
(a stray CR, a doubled quote, a CR inside quotes) take the segment-building paths.
A short warm-up pass at import exercises the hot paths before the first case.

On the kit's practice set (6 files, ~10.3M characters) the parse runs about 3×
faster than the reference reader, and its answers are byte-identical to the
oracle's — checked against the practice reference and by differential testing
against csv-reader 1.0.0 itself on generated and hand-built edge cases.

`main.ts` is the competition's house driver, kept as instructed; the entry's own
work is `solve.js`.

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=5ttpknjz&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
