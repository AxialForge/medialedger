# Quality check of the release package

MediaLedger 2.4.0. Result: **PASS**.

## 1. Inventory against the manual

72 items and 515 controls in `ui_inventory.json`. Each control was looked for under its own item in the manual, in order.

Gaps: none.

Inventory entries that could not be traced to a line of source: 0.

## 2. Callout numbers against table rows

61 screens, 460 callouts. Every number drawn on a picture was compared with the row of the same number in the table.

Mismatches: none.

Items described without a picture of their own (11): sidebar, d01_confirm_identity, d02_one_at_a_time, d03_dry_run_result, d04_batch_items, d05_undo_batch, d06_rename_movies_live, d07_movie_batch_result, d08_set_source, d09_ignore_collisions, d10_card_settings_legacy. These are short dialogs and the sidebar; their tables carry no numbers.

## 3. Documents

| Document | Pages | Pictures | Contents lines | Contents pointing at the wrong page | Problems |
|---|---|---|---|---|---|
| USER_MANUAL | 123 | 67 | 97 | 0 | none |
| PI_INSTALL_GUIDE | 16 | 4 | 27 | 0 | none |
| RELEASE_HISTORY | 25 | 0 | 49 | 0 | none |

