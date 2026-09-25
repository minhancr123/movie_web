param([Parameter(Mandatory=$true)][string]$InputDocx,
      [Parameter(Mandatory=$true)][string]$OutputPdf)
$ErrorActionPreference='Stop'
$word=$null
$document=$null
try {
    $word=New-Object -ComObject Word.Application
    $word.Visible=$false
    $word.DisplayAlerts=0
    $document=$word.Documents.Open($InputDocx, $false, $true)
    $document.Repaginate()
    $pages=$document.ComputeStatistics(2)
    $document.ExportAsFixedFormat($OutputPdf,17)
    Write-Output "WORD_RENDER_OK pages=$pages pdf=$OutputPdf"
} finally {
    if($null -ne $document){$document.Close(0); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document)}
    if($null -ne $word){$word.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)}
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
