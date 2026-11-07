import type { EvidenceReport } from "@/services/types";

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Builds the PDF in the browser. jsPDF is loaded on demand to keep it out of the main bundle. */
export async function exportEvidencePdf(report: EvidenceReport, fileName: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageHeight = doc.internal.pageSize.getHeight();
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageHeight - margin) return;
    doc.addPage();
    y = margin;
  };

  const write = (
    text: string,
    size: number,
    style: "normal" | "bold" = "normal",
    font = "helvetica",
  ) => {
    doc.setFont(font, style).setFontSize(size);
    for (const line of doc.splitTextToSize(text, width) as string[]) {
      ensureSpace(size + 4);
      doc.text(line, margin, y);
      y += size + 4;
    }
  };

  write(`Evidence report: ${report.ens}`, 16, "bold");
  write(
    `Period ${iso(report.from)} to ${iso(report.to)}. Generated ${new Date(report.generatedAt).toISOString()}.`,
    9,
  );
  write(`Labelhash ${report.robotId}`, 8, "normal", "courier");
  y += 10;

  for (const s of report.sections) {
    ensureSpace(60);
    write(`[${s.status.toUpperCase()}] ${s.title}`, 12, "bold");
    write(s.article, 8);
    write(s.description, 9);
    if (s.note) write(`Note: ${s.note}`, 9);
    if (s.retention)
      write(`Retention: ${s.retention.coveredDays}/${s.retention.requiredDays} days covered.`, 9);
    if (!s.sources.length) write("Missing: no records found for this period.", 9, "bold");
    for (const source of s.sources) {
      write(source.label, 8);
      doc.setFont("courier", "normal").setFontSize(7);
      ensureSpace(11);
      if (source.href) {
        doc.setTextColor(30, 80, 200);
        doc.textWithLink(source.ref, margin, y, { url: source.href });
        doc.setTextColor(0);
      } else {
        doc.text(source.ref, margin, y);
      }
      y += 11;
    }
    y += 12;
  }

  write("Supports evidence preparation. Not legal advice or certification.", 8);
  doc.save(fileName);
}
