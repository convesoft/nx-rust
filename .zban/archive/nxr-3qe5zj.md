---
title: Measure the cost of cargo affected status
status: done
type: task
tags:
  - spike
parent: nxr-m3k3w8
created_at: 2026-11-12T18:20:01Z
closed_at: 2026-11-16T13:02:38Z
---

Goal: confirm or refute the second assumption in `RISK-CARGO-AFFECTED` (`nx-rust/docs/decisions.mara.md`): that asking for the selection is cheap although it lists tests through nextest, which needs built test binaries.

- [x] Time `status` on a real workspace with a warm and with a cold build directory
- [x] Compare with the time the selected tests save
- [x] Record the finding as an evidence item (`EVD-`) in `nx-rust/docs/decisions.mara.md` that supports or contradicts the items above
- [x] Update the risk (likelihood, consequence, or retire it) and every design or decision the finding changes

Done when: the evidence item is accepted in Mara, and `mara project validate` reports `valid: true`.

## Summary of Changes

Timed `cargo affected status` exclusively, three runs each, on ripgrep and on tokio (`-j 4`, 4 test threads), with warm and cold build directories, for small, large and no changes, against the selected and the full nextest runs. Recorded in `EVD-CARGO-AFFECTED-COST`. Status builds only what the following run uses. Its own cost is 0.14 to 0.16 s on ripgrep and 0.6 to 1.4 s on tokio, against full suites of 1 s and 15 s. The break-even is at about 85 % and 93 % of the suite's time. Small changes saved 0.76 s and 14 s. Collection peaked at 1.5 GiB on ripgrep and 4.75 GiB on tokio. The assumption holds. `DES-TEST-MODE` now says that the mode command reads the database and never starts status. Checks as for nxr-hvw1rq.
