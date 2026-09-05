Automated measurements from radiographs.

On Windows, download the current [Spine-Contour installer](https://github.com/mjayasur/Spine-Contour/releases/download/latest-windows/Spine-Contour-Windows.exe) and open it. Choose a radiograph, leave X-ray, Lumbar, and Lateral selected, then click **Measure radiograph**.

## Workspace

The Workspace screen is part of the redesigned app on this branch; it is not in the current
`latest-windows` installer linked above.

It loads a folder of radiographs into the Studies library in one step, with an optional
clinical-data CSV.

- **Choose folder…** scans the folder and its subfolders for `.dcm`, `.dicom`, `.png`, `.jpg`,
  `.jpeg`, `.tif`, `.tiff` and `.bmp` files in any letter case. Other files, links and junctions
  are skipped and counted, as is any subfolder that cannot be read; links are never followed.
- **Choose CSV…** (optional) reads a file with one row per study and a `study_id` column. Rows
  join films on the film's filename without its extension, case-insensitively — `SP001.dcm`
  takes the row whose `study_id` is `SP001` or `sp001`. Rows that match no film are counted in
  the load message and not stored; when two rows share a `study_id` the first wins; when two
  films share a stem the row is attached to neither.
- Only the nine known clinical fields auto-map — Age, Sex, BMI, Diagnosis, ODI, Treatment plan,
  Surgical history, Follow-up, Notes — by prefix on the column name (`age_yrs` → Age,
  `odi_base` → ODI). Any other column can be mapped from the dropdown on its chip or left
  unmapped. `study_id` itself is the join key, not a field.
- **Load workspace** adds each new film to Studies as `Processing` and attaches its CSV
  values. Films already in the library (same path) are not added again; the CSV only **fills
  in** clinical fields they are missing and never overwrites a value that is already there
  (use **Import from CSV** on the study's Analysis screen to replace values deliberately).
  Open a study and run segmentation from its Analysis screen; nothing runs automatically.
- On the Analysis screen the **Clinical data** drawer shows the study's fields. **Import from
  CSV** pulls the matching row from the workspace CSV loaded this session. Values are saved
  with the study; demo studies are not saved and their cells are read-only. The `×` on a
  column head **hides** that column for the session — the values stay on the studies, and the
  column comes back at the next launch if any study still holds a value for it.
- Deleting a study from the Studies list removes its record and its saved segmentation
  (`predictions/<id>.json` in the app's data folder). The film on disk is not touched.

The app's own **Export CSV** file cannot be loaded back in through the Workspace. Three separate
things stop it, and `docs/ROADMAP.md` (item 1) sets out each of them and the design decision a
fix has to make first.

## Models

Three structures are read from a lateral film — the L1–L5 vertebral bodies, the S1
endplate, and the femoral heads — and **Settings** in the sidebar shows which model reads
each. The femoral heads and the S1 endplate each have one. The vertebral bodies have two,
and the choice applies to the next run:

- **U-Net** segments each body and reads its corners off the mask.
- **HRNet** regresses each corner directly. It can place a corner where a mask
  has no pixels, so it never leaves a level out — and, for the same reason, it has no
  missing level to report when it is wrong.

Each study's Analysis header names the model that produced the numbers on screen, and the
saved result records it, so a library measured with both can still be told apart.

Before any model runs, the backend finds the lumbosacral region on the film and frames
it the way the models were trained to see it: a box slides over the lower film and the
best-framed one wins, with the whole film competing as one more box. A lumbar radiograph
wins as a whole; a full-spine radiograph is cropped. The frame is recorded with the
result.

## Test data

No radiograph ships with the app or the installer. Test with your own de-identified
lateral lumbar films, or with a public dataset:

- **BUU-LSPINE** — paper: https://www.mdpi.com/2076-3417/13/15/8646 — dataset: https://services.informatics.buu.ac.th/spine/
- **VinDr-SpineXR** — paper: https://arxiv.org/html/2106.12930v1 — dataset: https://physionet.org/content/vindr-spinexr/1.0.0/
- **Merlin** — paper: https://arxiv.org/abs/2406.06512 — dataset: see the paper

Each dataset has its own access terms and licence; check them before use. None of these
datasets is bundled with, or endorsed by, this project.
