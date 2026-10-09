#!/usr/bin/env python3
"""
Step 3 Automation Tool: Interactive Financial Reconciliation Workbench
Self-contained Web Application delivering human-in-the-loop review,
batch reconciliation, anomaly inspection, and audit-trail generation.
"""

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from decimal import Decimal
from datetime import datetime, timezone

from .config import (
    DEFAULT_INVOICES_JSON_PATH,
    DEFAULT_REFERENCE_EXCEL_PATH,
    DEFAULT_REFERENCE_CSV_PATH,
    DEFAULT_AUDIT_LOG_PATH,
)
from .models import DecisionType
from .parsers.excel_reference_parser import ExcelReferenceParser
from .parsers.invoice_parser import InvoiceParser
from .cli import run_reconciliation

PORT = 8088

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Autonomous Financial Reconciliation Workbench | FDE Production Suite</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0b0f19;
      --bg-secondary: #111827;
      --bg-card: rgba(17, 24, 39, 0.75);
      --border: rgba(255, 255, 255, 0.08);
      --border-focus: rgba(99, 102, 241, 0.4);
      --accent-primary: #6366f1;
      --accent-hover: #4f46e5;
      --accent-gradient: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      --text-main: #f9fafb;
      --text-muted: #9ca3af;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --info: #3b82f6;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background: var(--bg-primary);
      color: var(--text-main);
      font-family: 'Outfit', -apple-system, sans-serif;
      min-height: 100vh;
      padding: 2.5rem 3rem;
      line-height: 1.5;
      background-image: 
        radial-gradient(at 10% 10%, rgba(99, 102, 241, 0.12) 0px, transparent 50%),
        radial-gradient(at 90% 90%, rgba(168, 85, 247, 0.08) 0px, transparent 50%);
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .logo-badge {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: var(--accent-gradient);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1.25rem;
      box-shadow: 0 8px 24px rgba(99, 102, 241, 0.3);
    }
    .brand-text h1 {
      font-size: 1.6rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .brand-text p {
      font-size: 0.875rem;
      color: var(--text-muted);
    }
    .controls {
      display: flex;
      gap: 1rem;
    }
    button {
      padding: 0.65rem 1.25rem;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid transparent;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-family: inherit;
    }
    .btn-primary {
      background: var(--accent-gradient);
      color: white;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
    }
    .btn-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5);
    }
    .btn-secondary {
      background: var(--bg-secondary);
      color: var(--text-main);
      border-color: var(--border);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.2);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1.5rem;
      margin-bottom: 2.5rem;
    }
    .stat-card {
      background: var(--bg-card);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 1.5rem;
      position: relative;
      overflow: hidden;
      transition: transform 0.2s, border-color 0.2s;
    }
    .stat-card:hover {
      transform: translateY(-2px);
      border-color: var(--border-focus);
    }
    .stat-title {
      font-size: 0.8125rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      display: flex;
      justify-content: space-between;
    }
    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .stat-sub {
      font-size: 0.8125rem;
      color: var(--text-muted);
      margin-top: 0.35rem;
    }
    .stat-card.approved .stat-value { color: var(--success); }
    .stat-card.escalated .stat-value { color: var(--warning); }
    .stat-card.rejected .stat-value { color: var(--danger); }
    .stat-card.total .stat-value { color: var(--info); }
    
    .panel {
      background: var(--bg-card);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 2rem;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
    }
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }
    .panel-header h2 {
      font-size: 1.25rem;
      font-weight: 600;
    }
    .filters {
      display: flex;
      gap: 0.5rem;
      background: rgba(0, 0, 0, 0.2);
      padding: 0.25rem;
      border-radius: 10px;
      border: 1px solid var(--border);
    }
    .filter-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 0.4rem 0.85rem;
      border-radius: 8px;
      font-size: 0.8125rem;
      cursor: pointer;
    }
    .filter-btn.active {
      background: var(--bg-secondary);
      color: var(--text-main);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0 0.5rem;
    }
    th {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      text-align: left;
      padding: 0.75rem 1.25rem;
      font-weight: 600;
    }
    td {
      background: rgba(255, 255, 255, 0.02);
      padding: 1.1rem 1.25rem;
      font-size: 0.875rem;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }
    tr td:first-child {
      border-left: 1px solid var(--border);
      border-top-left-radius: 12px;
      border-bottom-left-radius: 12px;
    }
    tr td:last-child {
      border-right: 1px solid var(--border);
      border-top-right-radius: 12px;
      border-bottom-right-radius: 12px;
    }
    tr:hover td {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.15);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.25rem 0.65rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .badge.approved {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge.escalated {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .badge.rejected {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .mono {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8125rem;
    }
    .reason-text {
      max-width: 320px;
      color: var(--text-muted);
      font-size: 0.8125rem;
    }
    .action-btn {
      padding: 0.4rem 0.75rem;
      font-size: 0.75rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-secondary);
      color: var(--text-main);
      cursor: pointer;
    }
    .action-btn:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    /* Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(8px);
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .modal {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 20px;
      width: 100%;
      max-width: 500px;
      padding: 2rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .modal-title {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 1rem;
    }
    textarea {
      width: 100%;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      color: var(--text-main);
      border-radius: 10px;
      padding: 0.75rem;
      margin: 1rem 0;
      font-family: inherit;
      resize: vertical;
      min-height: 80px;
    }
    textarea:focus {
      outline: none;
      border-color: var(--accent-primary);
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }
  </style>
</head>
<body>

  <header>
    <div class="brand">
      <div class="logo-badge">AR</div>
      <div class="brand-text">
        <h1>Autonomous Financial Reconciliation Workbench</h1>
        <p>Step 3 Hybrid AI / Deterministic Audit Engine &bull; Port 5133 SPA &amp; Excel Bridge</p>
      </div>
    </div>
    <div class="controls">
      <button class="btn-secondary" onclick="runDryRun()">⚡ Run Dry-Run Simulation</button>
      <button class="btn-primary" onclick="recalculateBatch()">🚀 Execute Certified Reconciliation</button>
    </div>
  </header>

  <section class="stats-grid">
    <div class="stat-card total">
      <div class="stat-title">Total Batch Value <span>📦</span></div>
      <div class="stat-value" id="val-total">¥0</div>
      <div class="stat-sub" id="count-total">0 invoices in queue</div>
    </div>
    <div class="stat-card approved">
      <div class="stat-title">Auto-Approved (Passed) <span>✅</span></div>
      <div class="stat-value" id="val-approved">¥0</div>
      <div class="stat-sub" id="count-approved">0 items (0% auto-cleared)</div>
    </div>
    <div class="stat-card escalated">
      <div class="stat-title">Manager Escalations <span>⚠️</span></div>
      <div class="stat-value" id="val-escalated">¥0</div>
      <div class="stat-sub" id="count-escalated">0 items (Over ¥500k limit)</div>
    </div>
    <div class="stat-card rejected">
      <div class="stat-title">Audit Exceptions <span>⛔</span></div>
      <div class="stat-value" id="val-rejected">¥0</div>
      <div class="stat-sub" id="count-rejected">0 items (Discrepancies / Rogue)</div>
    </div>
  </section>

  <main class="panel">
    <div class="panel-header">
      <h2>Invoice &amp; Expense Transaction Register</h2>
      <div class="filters">
        <button class="filter-btn active" onclick="setFilter('ALL')">All Items</button>
        <button class="filter-btn" onclick="setFilter('APPROVED')">Approved</button>
        <button class="filter-btn" onclick="setFilter('ESCALATED')">Escalated</button>
        <button class="filter-btn" onclick="setFilter('REJECTED')">Exceptions</button>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Invoice ID</th>
          <th>Supplier</th>
          <th>Cost Center</th>
          <th>Subtotal</th>
          <th>Tax (10%)</th>
          <th>Total (JPY)</th>
          <th>Validation Reason</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody id="invoice-tbody">
        <!-- Invoices injected here -->
      </tbody>
    </table>
  </main>

  <div class="modal-overlay" id="overrideModal">
    <div class="modal">
      <div class="modal-title" id="modalTitle">Override Approval Decision</div>
      <p style="font-size: 0.875rem; color: var(--text-muted);" id="modalSubtitle">Provide reason for manual override:</p>
      <textarea id="modalComment" placeholder="Enter formal audit reason for approving over-limit or flagged expense..."></textarea>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="confirmOverride()">Authorize &amp; Sign</button>
      </div>
    </div>
  </div>

  <script>
    let currentData = null;
    let activeFilter = 'ALL';
    let selectedInvId = null;

    async function loadData() {
      const res = await fetch('/api/reconciliation');
      currentData = await res.json();
      render();
    }

    function render() {
      if (!currentData) return;
      document.getElementById('val-total').innerText = '¥' + currentData.total_value_jpy.toLocaleString();
      document.getElementById('count-total').innerText = currentData.total_invoices + ' invoices in queue';

      document.getElementById('val-approved').innerText = '¥' + currentData.value_by_decision_jpy.approved.toLocaleString();
      document.getElementById('count-approved').innerText = currentData.counts.approved + ' items (' + currentData.auto_approval_rate_pct + '% auto-cleared)';

      document.getElementById('val-escalated').innerText = '¥' + currentData.value_by_decision_jpy.escalated.toLocaleString();
      document.getElementById('count-escalated').innerText = currentData.counts.escalated + ' items (Over ¥500k limit)';

      document.getElementById('val-rejected').innerText = '¥' + currentData.value_by_decision_jpy.rejected.toLocaleString();
      document.getElementById('count-rejected').innerText = currentData.counts.rejected + ' items (Discrepancies / Rogue)';

      const tbody = document.getElementById('invoice-tbody');
      tbody.innerHTML = '';

      const filtered = currentData.results.filter(r => {
        if (activeFilter === 'ALL') return true;
        return r.decision === activeFilter;
      });

      filtered.forEach(r => {
        const tr = document.createElement('tr');
        const badgeClass = r.decision.toLowerCase();
        tr.innerHTML = `
          <td><span class="badge ${badgeClass}">${r.decision}</span></td>
          <td class="mono">${r.invoice_id}</td>
          <td><strong>${r.supplier_name}</strong></td>
          <td class="mono">${r.cost_center}</td>
          <td>¥${r.subtotal.toLocaleString()}</td>
          <td>¥${r.tax_amount.toLocaleString()}</td>
          <td><strong>¥${r.total_amount.toLocaleString()}</strong></td>
          <td class="reason-text">${r.reason}</td>
          <td>
            ${r.requires_human_review ? `<button class="action-btn" onclick="openOverride('${r.invoice_id}')">Review</button>` : `<span style="color:var(--text-muted);font-size:0.75rem;">Auto-signed</span>`}
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    function setFilter(f) {
      activeFilter = f;
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.toUpperCase().includes(f));
      });
      render();
    }

    async function recalculateBatch() {
      const res = await fetch('/api/reconcile', { method: 'POST', body: JSON.stringify({ dry_run: false }) });
      currentData = await res.json();
      render();
      alert('Batch reconciled and cryptographic audit receipts generated!');
    }

    async function runDryRun() {
      const res = await fetch('/api/reconcile', { method: 'POST', body: JSON.stringify({ dry_run: true }) });
      currentData = await res.json();
      render();
      alert('Dry-run simulation completed. Zero writes performed.');
    }

    function openOverride(id) {
      selectedInvId = id;
      document.getElementById('modalTitle').innerText = 'Authorize Invoice: ' + id;
      document.getElementById('modalComment').value = '';
      document.getElementById('overrideModal').style.display = 'flex';
    }

    function closeModal() {
      document.getElementById('overrideModal').style.display = 'none';
      selectedInvId = null;
    }

    async function confirmOverride() {
      const comment = document.getElementById('modalComment').value;
      if (!comment.trim()) {
        alert('Please provide an audit justification comment.');
        return;
      }
      await fetch('/api/override', {
        method: 'POST',
        body: JSON.stringify({ invoice_id: selectedInvId, comment: comment })
      });
      closeModal();
      loadData();
    }

    window.onload = loadData;
  </script>
</body>
</html>
"""


class ReconciliationHTTPHandler(BaseHTTPRequestHandler):
    """Zero-dependency HTTP request handler for the Reconciliation Workbench."""
    
    current_summary = None

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/" or parsed.path == "/index.html":
            body = HTML_TEMPLATE.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif parsed.path == "/api/reconciliation":
            if not ReconciliationHTTPHandler.current_summary:
                ReconciliationHTTPHandler.current_summary = run_reconciliation(dry_run=True)
            self._send_json(ReconciliationHTTPHandler.current_summary)
        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        parsed = urlparse(self.path)
        content_len = int(self.headers.get('Content-Length', 0))
        post_body = self.rfile.read(content_len).decode('utf-8') if content_len > 0 else "{}"
        try:
            payload = json.loads(post_body)
        except Exception:
            payload = {}

        if parsed.path == "/api/reconcile":
            dry_run = payload.get("dry_run", False)
            ReconciliationHTTPHandler.current_summary = run_reconciliation(dry_run=dry_run)
            self._send_json(ReconciliationHTTPHandler.current_summary)
        elif parsed.path == "/api/override":
            inv_id = payload.get("invoice_id")
            comment = payload.get("comment", "")
            if ReconciliationHTTPHandler.current_summary:
                for r in ReconciliationHTTPHandler.current_summary["results"]:
                    if r["invoice_id"] == inv_id:
                        r["decision"] = "APPROVED"
                        r["requires_human_review"] = False
                        r["reason"] = f"Manual override authorized: {comment}"
                        break
            self._send_json({"status": "ok", "invoice_id": inv_id})
        else:
            self.send_error(404, "Not Found")


def start_server(port: int = PORT):
    server = HTTPServer(("127.0.0.1", port), ReconciliationHTTPHandler)
    print(f"\n==========================================================================")
    print(f" Financial Reconciliation Workbench UI online at: http://127.0.0.1:{port}")
    print(f"==========================================================================\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping workbench server...")
        server.server_close()


if __name__ == "__main__":
    p = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    start_server(p)
