"use strict";

const TravelExcel = (() => {
  const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const officeRelationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const packageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";
  const encoder = new TextEncoder();
  const dayMs = 86_400_000;

  function xmlText(value) {
    return String(value).replace(/[&<>]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
    })[character]);
  }

  function cell(reference, value, style = 0) {
    if (typeof value === "number") {
      return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
    }
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
  }

  function excelDate(value) {
    // Excel's 1900 calendar includes a fictitious February 29.
    const offset = value < "1900-03-01" ? 25568 : 25569;
    return Date.parse(value + "T00:00:00Z") / dayMs + offset;
  }

  function worksheet(report) {
    const rows = [];
    function add(label, value, labelStyle = 0, valueStyle = 0, height = 18) {
      const index = rows.length + 1;
      rows.push(`<row r="${index}" ht="${height}" customHeight="1">${cell("A" + index, label, labelStyle)}${value === undefined ? "" : cell("B" + index, value, valueStyle)}</row>`);
    }

    add("국내 출장여비 계산 내역", undefined, 1, 0, 25);
    add(report.totalLabel + " (원)", report.total, 2, 3);
    add("출장 구분", report.summary);
    for (const [label, value] of report.details) {
      if (label === "출장 시작일" || label === "복귀일") {
        // Earlier dates cannot be displayed by Excel's 1900 date system.
        if (value >= "1900-01-01") add(label, excelDate(value), 0, 4);
        else add(label, value);
      } else {
        add(label, value);
      }
    }
    add("항목", "지급액 (원)", 2, 2);
    for (const [label, amount] of report.rows) add(label, amount, 0, 5);
    for (const note of report.notes) {
      add("적용 사항", note, 0, 6, 18 * Math.ceil(note.length / 34));
    }
    add("계산 근거", report.basis, 0, 6, 36);

    return `<worksheet xmlns="${spreadsheet}">
      <sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
      <cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="76" customWidth="1"/></cols>
      <sheetData>${rows.join("")}</sheetData>
    </worksheet>`;
  }

  const styles = `<styleSheet xmlns="${spreadsheet}">
    <numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
    <fonts count="3">
      <font><sz val="11"/><name val="Malgun Gothic"/></font>
      <font><b/><sz val="15"/><name val="Malgun Gothic"/></font>
      <font><b/><sz val="11"/><name val="Malgun Gothic"/></font>
    </fonts>
    <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
      <fill><patternFill patternType="solid"><fgColor rgb="FFE8F6F1"/><bgColor indexed="64"/></patternFill></fill>
    </fills>
    <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    <cellXfs count="7">
      <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
      <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
      <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
      <xf numFmtId="3" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>
      <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
      <xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
      <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    </cellXfs>
    <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  </styleSheet>`;

  function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
    }
    return (crc ^ -1) >>> 0;
  }

  // XLSX is a ZIP of XML parts. Store the small report without compression.
  function zip(parts) {
    const files = [];
    const directory = [];
    let fileOffset = 0;
    let directorySize = 0;

    for (const [path, xml] of Object.entries(parts)) {
      const name = encoder.encode(path);
      const bytes = encoder.encode('<?xml version="1.0" encoding="UTF-8"?>' + xml);
      const crc = crc32(bytes);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(12, 33, true); // DOS date 1980-01-01.
      local.setUint32(14, crc, true);
      local.setUint32(18, bytes.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, name.length, true);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(14, 33, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, bytes.length, true);
      central.setUint32(24, bytes.length, true);
      central.setUint16(28, name.length, true);
      central.setUint32(42, fileOffset, true);

      files.push(local.buffer, name, bytes);
      directory.push(central.buffer, name);
      fileOffset += local.byteLength + name.length + bytes.length;
      directorySize += central.byteLength + name.length;
    }

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, directory.length / 2, true);
    end.setUint16(10, directory.length / 2, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, fileOffset, true);
    return new Blob([...files, ...directory, end.buffer], { type: mimeType });
  }

  function build(report) {
    return zip({
      "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      </Types>`,
      "_rels/.rels": `<Relationships xmlns="${packageRelationships}">
        <Relationship Id="rId1" Type="${officeRelationships}/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`,
      "xl/workbook.xml": `<workbook xmlns="${spreadsheet}" xmlns:r="${officeRelationships}">
        <bookViews><workbookView/></bookViews>
        <sheets><sheet name="출장여비" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${packageRelationships}">
        <Relationship Id="rId1" Type="${officeRelationships}/worksheet" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Type="${officeRelationships}/styles" Target="styles.xml"/>
      </Relationships>`,
      "xl/styles.xml": styles,
      "xl/worksheets/sheet1.xml": worksheet(report),
    });
  }

  function download(report) {
    const url = URL.createObjectURL(build(report));
    const link = document.createElement("a");
    link.href = url;
    link.download = `출장여비_${report.start}_${report.end}.xlsx`;
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  return { download };
})();
