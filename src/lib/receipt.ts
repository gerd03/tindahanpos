import jsPDF from 'jspdf';
import type { AppData } from '../types';
import { formatDateTime, roundMoney } from './format';
import { buildCustomerSummaries, buildUnpaidLedgerItems } from './ledger';

export interface ReceiptRow {
  id: string;
  date: string;
  description: string;
  type: 'debt' | 'payment';
  itemName: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
}

export interface ReceiptData {
  storeName: string;
  ownerName: string;
  customerName: string;
  generatedAt: string;
  rows: ReceiptRow[];
  finalBalance: number;
}

export function buildReceiptData(data: AppData, customerId: string): ReceiptData {
  const customer = data.customers.find((item) => item.id === customerId);
  if (!customer) throw new Error('Customer not found.');

  const summary = buildCustomerSummaries(data).find(
    (item) => item.customer.id === customerId,
  );

  const rows = buildUnpaidLedgerItems(data, customerId).map(({ entry, remaining }) => {
    return {
      id: entry.id,
      date: entry.createdAt,
      description: entry.itemName,
      type: 'debt' as const,
      itemName: entry.itemName,
      quantity: entry.quantity,
      unitPrice: entry.unitPrice,
      amount: remaining,
    };
  });
  const finalBalance = roundMoney(rows.reduce((sum, row) => sum + row.amount, 0));

  return {
    storeName: data.settings.storeName,
    ownerName: data.settings.ownerName.trim(),
    customerName: customer.name,
    generatedAt: new Date().toISOString(),
    rows,
    finalBalance: summary?.balance ?? finalBalance,
  };
}

export function createCustomerReceiptPdf(data: AppData, customerId: string): jsPDF {
  const receipt = buildReceiptData(data, customerId);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  const footerY = pageHeight - 34;
  const table = {
    left: margin,
    right: pageWidth - margin,
    dateRight: margin + 84,
    itemRight: margin + 310,
    qtyRight: margin + 356,
    unitRight: margin + 440,
  };
  const columns = {
    date: table.left + 6,
    item: table.dateRight + 6,
    qty: table.qtyRight - 6,
    unit: table.unitRight - 6,
    amount: table.right - 6,
  };
  let pageNumber = 1;
  let y = 40;

  function addHeader() {
    drawShopIcon(doc, margin, y, 34);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text(receipt.storeName, margin + 46, y + 14, { maxWidth: contentWidth - 46 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Utang Receipt', margin + 46, y + 30);
    y += 52;
    doc.setDrawColor(0, 0, 0);
    doc.line(margin, y, pageWidth - margin, y);
    y += 18;

    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Customer', margin, y);
    doc.text('Generated', margin + 282, y);
    doc.setFont('helvetica', 'normal');
    doc.text(receipt.customerName, margin, y + 15);
    doc.text(formatDateTime(receipt.generatedAt), margin + 282, y + 15);
    y += 38;
  }

  function addFooter() {
    doc.setDrawColor(0, 0, 0);
    doc.line(margin, footerY - 16, pageWidth - margin, footerY - 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    if (receipt.ownerName) {
      doc.text(`Owner: ${receipt.ownerName}`, margin, footerY);
    }
    doc.text(`Page ${pageNumber}`, pageWidth - margin, footerY, { align: 'right' });
  }

  function addTableHeader() {
    const headerHeight = 24;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.8);
    doc.rect(table.left, y, table.right - table.left, headerHeight);
    drawTableVerticals(y, y + headerHeight);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text('Date', columns.date, y + 14);
    doc.text('Item / Note', columns.item, y + 14);
    doc.text('Qty', columns.qty, y + 14, { align: 'right' });
    doc.text('Unit', columns.unit, y + 14, { align: 'right' });
    doc.text('Amount', columns.amount, y + 14, { align: 'right' });
    y += headerHeight;
  }

  function newPage() {
    addFooter();
    doc.addPage();
    pageNumber += 1;
    y = 40;
    addTableHeader();
  }

  function drawTableVerticals(top: number, bottom: number) {
    for (const x of [table.dateRight, table.itemRight, table.qtyRight, table.unitRight]) {
      doc.line(x, top, x, bottom);
    }
  }

  addHeader();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text('Details', margin, y);
  y += 14;
  addTableHeader();

  if (!receipt.rows.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text('No utang records yet.', margin, y + 18);
    y += 42;
  }

  for (const row of receipt.rows) {
    const itemLines = doc.splitTextToSize(row.itemName, 210) as string[];
    const dateLines = doc.splitTextToSize(shortPdfDate(row.date), 72) as string[];
    const rowHeight = Math.max(38, 16 + Math.max(itemLines.length, dateLines.length) * 11);
    if (y + rowHeight > footerY - 26) newPage();

    doc.setDrawColor(170, 185, 176);
    doc.setLineWidth(0.6);
    doc.rect(table.left, y, table.right - table.left, rowHeight);
    drawTableVerticals(y, y + rowHeight);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(0, 0, 0);
    doc.text(dateLines, columns.date, y + 12);
    doc.text(itemLines, columns.item, y + 12);

    doc.text(row.quantity === null ? '-' : String(row.quantity), columns.qty, y + 12, {
      align: 'right',
    });
    doc.text(row.unitPrice === null ? '-' : pdfMoney(row.unitPrice), columns.unit, y + 12, {
      align: 'right',
    });
    doc.text(pdfMoney(row.amount), columns.amount, y + 12, {
      align: 'right',
    });
    y += rowHeight;
  }

  const totalsHeight = 48;
  if (y + totalsHeight > footerY - 20) newPage();
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.8);
  doc.rect(table.left, y, table.right - table.left, 34);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('Total Active Utang', table.left + 6, y + 21);
  doc.text(pdfMoney(receipt.finalBalance), table.right - 6, y + 21, { align: 'right' });

  addFooter();
  return doc;
}

export function makeReceiptFilename(customerName: string, storeName = ''): string {
  const safeStore = toPascalFilePart(storeName) || 'SukiTrack';
  const safeName = toPascalFilePart(customerName) || 'Customer';
  return `${safeName}_SukiTrack_${safeStore}_${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;
}

function toPascalFilePart(value: string): string {
  return value
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function pdfMoney(value: number): string {
  return `PHP ${roundMoney(value).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function shortPdfDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date
    .toLocaleString('en-PH', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    .replace(',', '');
}

function drawShopIcon(doc: jsPDF, x: number, y: number, size: number): void {
  const scale = size / 34;
  const sx = (value: number) => x + value * scale;
  const sy = (value: number) => y + value * scale;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(1.2);
  doc.rect(sx(7), sy(14), 20 * scale, 16 * scale);
  doc.line(sx(4), sy(14), sx(30), sy(14));
  doc.line(sx(8), sy(7), sx(26), sy(7));
  doc.line(sx(8), sy(7), sx(4), sy(14));
  doc.line(sx(26), sy(7), sx(30), sy(14));
  doc.line(sx(12), sy(14), sx(12), sy(21));
  doc.line(sx(17), sy(14), sx(17), sy(21));
  doc.line(sx(22), sy(14), sx(22), sy(21));
  doc.rect(sx(15), sy(21), 6 * scale, 9 * scale);
  doc.rect(sx(9), sy(21), 4 * scale, 4 * scale);
  doc.rect(sx(23), sy(21), 4 * scale, 4 * scale);
}
