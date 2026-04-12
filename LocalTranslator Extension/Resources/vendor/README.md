# vendor/

Third-party binary assets live here. They are **not** committed to the repo
(see the root `.gitignore`) because of size and licensing. Fetch them once
locally and drop the files into place — see the "Setup / Drop in the binary
assets" section of the repo root README for the exact file list.

Expected tree:

```
vendor/
├── tesseract/
│   ├── tesseract.min.js
│   ├── worker.min.js
│   └── tesseract-core.wasm.js
└── traineddata/
    ├── jpn.traineddata
    ├── chi_sim.traineddata
    └── chi_tra.traineddata
```

All of these are loaded via `chrome-extension://` URLs at runtime — the code
never fetches them over the network.
