# Release documentation tools

Throwaway tools that build the release package in `docs/release-package/<version>/`. They read the
application and never change it. Nothing here is part of MediaLedger itself.

Needs: Node (the repository's own `npm ci`), Python 3 with Pillow and PyMuPDF, Microsoft Word for the
PDF export of the two Word documents, and once `npm install` in this folder for the diagram renderer.

```bash
T=docs/_tools/release-docs; O=docs/release-package/<version>; TAG=v<version>
npx electron $T/capture.js --data=$T/demo-data --out=$T/out          # rebuilds the fictional data, takes the pictures
python $T/annotate.py $T/out $O/screenshots                          # draws the callouts
node $T/build-inventory.js $O/ui_inventory.json $T/out/boxes.json    # ui_inventory.json
npx electron $T/render-mermaid.js $O/diagrams/architecture.mmd $O/diagrams/architecture.png
bash $T/clean-build.sh $TAG <empty work folder> $O/clean-build-result.json --installer
node $T/build-user-manual.js $O
node $T/build-release-overview.js $O
node $T/build-developer-guide.js $O $O/clean-build-result.json
powershell -File $T/to-pdf.ps1 $O/USER_MANUAL.docx $O/RELEASE_OVERVIEW.docx
npx electron $T/md-to-pdf.js $O/DEVELOPER_GUIDE.md $O/DEVELOPER_GUIDE.pdf "MediaLedger <version> · Developer and Rebuild Guide"
python $T/qa-check.py $O $T/out                                      # QA_REPORT.md
python $T/make-archive.py $TAG $O <clean build folder> <work folder> # the archive, its manifest, the secret scan
```

The single source for what is on each screen is `screens.js` plus `controls/*.js`. The callouts, the tables in
the manual and the inventory are all generated from it.

The screenshots never show real data. `make-demo-data.js` invents a library with a fixed seed, and `capture.js`
replaces the name, addresses and adapter names of the computer it runs on before each picture is taken.
The demo account's password is written in `capture.js`; it protects nothing.
