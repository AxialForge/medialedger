# Opens a .docx in Word, updates the table of contents and every field, saves it, and exports a PDF beside it.
#   powershell -File docs/_tools/release-docs/to-pdf.ps1 <file.docx> [<file.docx> ...]
param([Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Files)
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  foreach ($f in $Files) {
    $full = (Resolve-Path $f).Path
    $doc = $word.Documents.Open($full)
    foreach ($t in $doc.TablesOfContents) { $t.Update() }
    $null = $doc.Fields.Update()
    foreach ($s in $doc.Sections) { foreach ($h in $s.Headers) { $null = $h.Range.Fields.Update() }; foreach ($ft in $s.Footers) { $null = $ft.Range.Fields.Update() } }
    $doc.Repaginate()
    foreach ($t in $doc.TablesOfContents) { $t.UpdatePageNumbers() }
    $pages = $doc.ComputeStatistics(2)
    $shapes = $doc.InlineShapes.Count
    $toc = if ($doc.TablesOfContents.Count -gt 0) { ($doc.TablesOfContents.Item(1).Range.Paragraphs.Count) } else { 0 }
    $doc.Save()
    $pdf = [System.IO.Path]::ChangeExtension($full, '.pdf')
    $doc.SaveAs2([ref]$pdf, [ref]17)   # 17 = PDF
    Write-Output ("{0}: {1} pages, {2} pictures, {3} contents lines" -f [System.IO.Path]::GetFileName($full), $pages, $shapes, $toc)
    try { $doc.Close(0) } catch { }
  }
} finally { try { $word.Quit() } catch { } }
