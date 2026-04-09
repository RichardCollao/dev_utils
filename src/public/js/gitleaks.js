document.addEventListener('DOMContentLoaded', function () {
  runButton = byId('btnRunGitleaks');
  clearConsoleButton = byId('btnClearGitleaksConsole');
  reportButton = byId('btnOpenGitleaksReport');
  downloadPdfButton = byId('btnDownloadGitleaksPdf');

  ensureTerminal();
  setRunButtonState(false);

  if (runButton) {
    runButton.addEventListener('click', runGitleaks);
  }

  if (clearConsoleButton) {
    clearConsoleButton.addEventListener('click', clearConsole);
  }

  if (reportButton) {
    reportButton.addEventListener('click', function () {
      openReportModal();
    });
  }

  if (downloadPdfButton) {
    downloadPdfButton.addEventListener('click', function () {
      downloadReportPdf();
    });
  }

  globalThis.addEventListener('resize', function () {
    if (resizeTimeoutId) {
      clearTimeout(resizeTimeoutId);
    }

    resizeTimeoutId = setTimeout(function () {
      fitTerminal(true);
    }, 80);
  });
});

let terminal = null;
let fitAddon = null;
let socket = null;
let runButton = null;
let clearConsoleButton = null;
let reportButton = null;
let downloadPdfButton = null;
let terminalInputDisposable = null;
let pendingRunPayload = null;
let resizeTimeoutId = null;
let latestFindingsReport = [];
let latestFilesAnalyzedCount = 0;
let latestExcludeGitIgnored = true;
let latestGitIgnoreMessage = 'Se excluyen los archivos definidos en .gitignore.';
let reportModalInstance = null;

function byId(id) {
  return document.getElementById(id);
}

function setRunButtonState(disabled) {
  if (runButton) {
    runButton.disabled = !!disabled;
  }
}

function setReportButtonState(disabled) {
  if (reportButton) {
    reportButton.disabled = !!disabled;
  }
}

function setDownloadPdfButtonState(disabled) {
  if (downloadPdfButton) {
    downloadPdfButton.disabled = !!disabled;
  }
}

function getReportModal() {
  const modalElement = byId('gitleaksReportModal');
  if (!modalElement || typeof bootstrap === 'undefined' || !bootstrap.Modal) return null;

  if (!reportModalInstance) {
    reportModalInstance = new bootstrap.Modal(modalElement);
  }

  return reportModalInstance;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getCommitDisplayValue(git) {
  const commitHash = String(git?.commitHash || '').trim();

  if (!commitHash) {
    return 'N/A';
  }

  if (/^0{40}$/.test(commitHash)) {
    return 'Sin commit todavía';
  }

  return commitHash;
}

function formatDateTime24h(value) {
  if (!value) return '';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('es-CL', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatGitMeta(git) {
  if (!git) return '<span class="text-muted">Sin datos de Git</span>';

  const author = escapeHtml(git.author || '');
  const email = escapeHtml(git.authorMail || '');
  const commit = escapeHtml(getCommitDisplayValue(git));
  const summary = escapeHtml(git.summary || '');
  const date = formatDateTime24h(git.authorDate);
  const safeDate = escapeHtml(date);
  const authorEmail = email ? `&lt;${email}&gt;` : '';

  return [
    `<div><strong>Autor:</strong> ${author || 'N/A'} ${authorEmail}</div>`,
    `<div><strong>Fecha:</strong> ${safeDate || 'N/A'}</div>`,
    `<div><strong>Commit:</strong> <code>${commit || 'N/A'}</code></div>`,
    `<div><strong>Resumen:</strong> ${summary || 'N/A'}</div>`
  ].join('');
}

function buildReportSummaryHtml(totalFindings, totalFilesAnalyzed) {
  const findingsCount = Number.isFinite(Number(totalFindings)) ? Number(totalFindings) : 0;
  const filesCount = Number.isFinite(Number(totalFilesAnalyzed)) ? Number(totalFilesAnalyzed) : 0;
  const gitIgnoreBadgeLabel = latestExcludeGitIgnored ? 'Excluidos' : 'Incluidos';
  const gitIgnoreBadgeClass = latestExcludeGitIgnored
    ? 'gitleaks-report-badge-files'
    : 'gitleaks-report-badge-neutral';

  return `
    <div class="gitleaks-report-summary mt-3">
      <div class="gitleaks-report-summary-row">
        <span class="gitleaks-report-summary-label">Hallazgos encontrados</span>
        <span class="badge gitleaks-report-badge gitleaks-report-badge-findings">${findingsCount}</span>
      </div>
      <div class="gitleaks-report-summary-row">
        <span class="gitleaks-report-summary-label">Archivos analizados</span>
        <span class="badge gitleaks-report-badge gitleaks-report-badge-files">${filesCount}</span>
      </div>
      <div class="gitleaks-report-summary-row">
        <span class="gitleaks-report-summary-label">Archivos en .gitignore</span>
        <span class="badge gitleaks-report-badge ${gitIgnoreBadgeClass}">${gitIgnoreBadgeLabel}</span>
      </div>
    </div>
  `;
}

function updateReportInfoText() {
  const reportInfoText = byId('gitleaksReportInfoText');
  if (!reportInfoText) return;

  const suffix = latestGitIgnoreMessage ? ` ${latestGitIgnoreMessage}` : '';
  reportInfoText.textContent = `Solo se muestran hallazgos detectados.${suffix}`;
}

function groupFindingsByFile(findings) {
  const fileGroups = new Map();

  findings.forEach(function(item) {
    const filePath = String(item.hostFile || item.file || 'Archivo desconocido').trim() || 'Archivo desconocido';

    if (!fileGroups.has(filePath)) {
      fileGroups.set(filePath, []);
    }

    fileGroups.get(filePath).push(item);
  });

  return Array.from(fileGroups.entries())
    .sort(function(left, right) {
      return left[0].localeCompare(right[0], 'es');
    })
    .map(function(entry) {
      return {
        filePath: entry[0],
        findings: entry[1].slice().sort(function(left, right) {
          return Number(left.line || 0) - Number(right.line || 0);
        })
      };
    });
}

function renderFindingsReport(findings, totalFilesAnalyzed = 0, options = {}) {
  latestFindingsReport = Array.isArray(findings) ? findings : [];
  latestFilesAnalyzedCount = Number.isFinite(Number(totalFilesAnalyzed)) ? Number(totalFilesAnalyzed) : 0;
  latestExcludeGitIgnored = options.excludeGitIgnored !== false;
  latestGitIgnoreMessage = String(options.gitIgnoreMessage || '').trim();

  const body = byId('gitleaksReportBody');
  const count = byId('gitleaksReportCount');
  if (!body || !count) return;

  count.textContent = `${latestFindingsReport.length} hallazgo${latestFindingsReport.length === 1 ? '' : 's'}`;
  updateReportInfoText();

  if (!latestFindingsReport.length) {
    body.innerHTML = [
      '<div class="alert alert-success"><i class="bi bi-check-circle me-2"></i>No se detectaron hallazgos.</div>',
      buildReportSummaryHtml(0, latestFilesAnalyzedCount)
    ].join('');
    setReportButtonState(false);
    setDownloadPdfButtonState(false); // Permitir descarga PDF incluso sin hallazgos
    return;
  }

  const groupedFindings = groupFindingsByFile(latestFindingsReport);

  body.innerHTML = groupedFindings.map(function (group, groupIndex) {
    return `
      <div class="card mb-3 border-primary-subtle">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span><strong>Archivo #${groupIndex + 1}</strong></span>
          <span class="badge text-bg-primary">${group.findings.length} hallazgo${group.findings.length === 1 ? '' : 's'}</span>
        </div>
        <div class="card-body">
          <div class="mb-3"><strong>Archivo:</strong> <code>${escapeHtml(group.filePath)}</code></div>
          ${group.findings.map(function(item, findingIndex) {
            return `
              <div class="gitleaks-finding-item ${findingIndex > 0 ? 'mt-3 pt-3 border-top' : ''}">
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <span><strong>${escapeHtml(item.ruleId || 'rule')}</strong></span>
                  <span class="badge text-bg-warning">Línea ${escapeHtml(item.line || '?')}</span>
                </div>
                <div class="mb-2"><strong>Finding:</strong> <code>${escapeHtml(item.finding || '')}</code></div>
                <div class="mb-2"><strong>Secret:</strong> <code>${escapeHtml(item.secret || '')}</code></div>
                <div class="mb-2"><strong>Fingerprint:</strong> <code>${escapeHtml(item.fingerprint || '')}</code></div>
                <hr>
                ${formatGitMeta(item.git)}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('') + buildReportSummaryHtml(latestFindingsReport.length, latestFilesAnalyzedCount);

  setReportButtonState(false);
  setDownloadPdfButtonState(false);
}

function openReportModal() {
  const modal = getReportModal();
  if (!modal) return;
  modal.show();
}

function getSafePdfName() {
  const select = byId('selGitleaksProject');
  const raw = String(select?.value || 'gitleaks').trim();
  const lastPart = raw.split('/').findLast(function(part) {
    return !!part;
  }) || 'gitleaks';
  const safe = lastPart.replaceAll(/[^a-zA-Z0-9._-]+/g, '_');
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  return `gitleaks-report-${safe}-${stamp}.pdf`;
}

function addPdfLine(doc, text, x, y, pageWidth, lineHeight) {
  const maxWidth = pageWidth - (x * 2);
  const lines = doc.splitTextToSize(String(text || ''), maxWidth);
  let nextY = y;

  lines.forEach(function (line) {
    if (nextY > 280) {
      doc.addPage();
      nextY = 20;
    }

    doc.text(line, x, nextY);
    nextY += lineHeight;
  });

  return nextY;
}

function drawSectionChip(doc, text, x, y, width, height, style) {
  const fillColor = Array.isArray(style?.fillColor) ? style.fillColor : [241, 245, 249];
  const textColor = Array.isArray(style?.textColor) ? style.textColor : [51, 65, 85];

  doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
  doc.roundedRect(x, y, width, height, 1.5, 1.5, 'F');
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.text(String(text || ''), x + 2.5, y + 4.6);
  doc.setTextColor(0, 0, 0);
}

function getSeverityStyleByRule(ruleId) {
  const rule = String(ruleId || '').toLowerCase();
  
  // Reglas de alta severidad (crítico)
  if (rule.includes('api-key') || rule.includes('secret-key') || rule.includes('private-key') || 
      rule.includes('password') || rule.includes('token') || rule.includes('credential')) {
    return {
      label: 'CRÍTICO',
      fillColor: [254, 226, 226],
      textColor: [127, 29, 29]
    };
  }
  
  // Reglas de severidad alta
  if (rule.includes('jwt') || rule.includes('oauth') || rule.includes('database') || 
      rule.includes('connection') || rule.includes('auth')) {
    return {
      label: 'ALTO',
      fillColor: [255, 237, 213],
      textColor: [124, 45, 18]
    };
  }
  
  // Reglas de severidad media
  if (rule.includes('url') || rule.includes('email') || rule.includes('generic')) {
    return {
      label: 'MEDIO',
      fillColor: [254, 249, 195],
      textColor: [113, 63, 18]
    };
  }
  
  // Severidad por defecto
  return {
    label: 'INFO',
    fillColor: [219, 234, 254],
    textColor: [30, 64, 175]
  };
}

function getAnalysisResultStyleForGitleaks(totalFindings) {
  if (totalFindings === 0) {
    return {
      title: 'ANÁLISIS LIMPIO',
      subtitle: 'No se encontraron secretos o credenciales expuestas.',
      fillColor: [220, 252, 231],
      textColor: [22, 101, 52]
    };
  }
  
  if (totalFindings <= 3) {
    return {
      title: 'ANÁLISIS CON HALLAZGOS MENORES',
      subtitle: 'Se encontraron pocos hallazgos que requieren revisión.',
      fillColor: [254, 249, 195],
      textColor: [113, 63, 18]
    };
  }
  
  return {
    title: 'ANÁLISIS CON HALLAZGOS IMPORTANTES',
    subtitle: 'Se encontraron múltiples hallazgos que requieren atención inmediata.',
    fillColor: [254, 226, 226],
    textColor: [127, 29, 29]
  };
}

function downloadReportPdf() {
  const findings = Array.isArray(latestFindingsReport) ? latestFindingsReport : [];

  const jsPdfLib = globalThis.jspdf;
  if (!jsPdfLib || typeof jsPdfLib.jsPDF !== 'function') {
    if (typeof Swal !== 'undefined') {
      Swal.fire({ icon: 'error', title: 'PDF no disponible', text: 'No se pudo cargar la librería de PDF.' });
    }
    return;
  }

  const doc = new jsPdfLib.jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 18;

  // Título principal
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(51, 65, 85);
  y = addPdfLine(doc, 'Reporte de Seguridad - Gitleaks', 14, y, pageWidth, 8);
  y += 3;

  // Información básica
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(75, 85, 99);
  y = addPdfLine(doc, `Generado: ${formatDateTime24h(new Date())}`, 14, y, pageWidth, 5);
  y = addPdfLine(doc, latestGitIgnoreMessage || 'Se excluyen los archivos definidos en .gitignore.', 14, y, pageWidth, 5);
  y += 5;

  // Estado del análisis
  const analysisResultStyle = getAnalysisResultStyleForGitleaks(findings.length);
  doc.setFillColor(
    analysisResultStyle.fillColor[0],
    analysisResultStyle.fillColor[1],
    analysisResultStyle.fillColor[2]
  );
  doc.roundedRect(14, y - 4, pageWidth - 28, 16, 2, 2, 'F');
  doc.setTextColor(
    analysisResultStyle.textColor[0],
    analysisResultStyle.textColor[1],
    analysisResultStyle.textColor[2]
  );
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(analysisResultStyle.title, 17, y + 2.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(analysisResultStyle.subtitle, 17, y + 8.5);
  doc.setTextColor(0, 0, 0);
  y += 20;

  // Sección de resumen
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(51, 65, 85);
  y = addPdfLine(doc, 'Resumen', 14, y, pageWidth, 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(75, 85, 99);
  y = addPdfLine(doc, `Total de hallazgos: ${findings.length}`, 14, y, pageWidth, 5);
  y = addPdfLine(doc, `Archivos analizados: ${latestFilesAnalyzedCount}`, 14, y, pageWidth, 5);
  
  if (findings.length > 0) {
    const groupedFindings = groupFindingsByFile(findings);
    y = addPdfLine(doc, `Archivos afectados: ${groupedFindings.length}`, 14, y, pageWidth, 5);
  }
  y += 8;

  // Sección de hallazgos detallados
  if (findings.length === 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(51, 65, 85);
    y = addPdfLine(doc, 'Hallazgos', 14, y, pageWidth, 6);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(75, 85, 99);
    y = addPdfLine(doc, 'No se encontraron secretos o credenciales expuestas.', 14, y, pageWidth, 5);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(51, 65, 85);
    y = addPdfLine(doc, 'Hallazgos Detectados', 14, y, pageWidth, 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    findings.forEach(function(item, index) {
      const ruleId = String(item?.ruleId || 'N/A');
      const finding = String(item?.finding || '').trim() || 'Sin descripción';
      const filePath = String(item?.filePath || '').trim();
      const line = item?.line ? String(item.line) : 'N/A';
      const secret = String(item?.secret || '').substring(0, 20) + '...';
      const severityStyle = getSeverityStyleByRule(ruleId);

      // Configuración de la tarjeta
      const cardX = 14;
      const cardWidth = pageWidth - 28;
      const cardPaddingX = 4;
      const cardPaddingTop = 4;
      const cardPaddingBottom = 3;
      const cardGap = 2.5;

      // Configuración de chips
      const chipStartX = cardX + cardPaddingX;
      const chipHeight = 6;
      const chipGap = 2;
      const chipSidePadding = 6;
      const chipMinWidth = 24;

      const paragraphTopGap = 5.5;
      const textLineHeight = 5;
      const textX = cardX + cardPaddingX;
      const textMaxWidth = pageWidth - (textX * 2);

      // Crear chips
      const chips = [
        { text: severityStyle.label, style: severityStyle },
        { text: ruleId, style: { label: ruleId, fillColor: [241, 245, 249], textColor: [51, 65, 85] } }
      ].map(function(chip) {
        const label = String(chip.text || '').trim();
        const width = Math.max(chipMinWidth, doc.getTextWidth(label) + chipSidePadding);
        return {
          text: label,
          style: chip.style,
          width
        };
      });

      const chipBlockHeight = chipHeight;

      // Calcular líneas de texto
      const findingLines = doc.splitTextToSize(`Descripción: ${finding}`, textMaxWidth);
      const fileLines = doc.splitTextToSize(`Archivo: ${filePath || 'N/A'}`, textMaxWidth);
      const lineLines = doc.splitTextToSize(`Línea: ${line}`, textMaxWidth);
      const secretLines = doc.splitTextToSize(`Secret: ${secret}`, textMaxWidth);
      
      let gitLines = [];
      const git = item.git || null;
      if (git) {
        const gitEmail = git.authorMail ? ` <${git.authorMail}>` : '';
        const commitLabel = getCommitDisplayValue(git);
        gitLines = [
          ...doc.splitTextToSize(`Autor: ${git.author || 'N/A'}${gitEmail}`, textMaxWidth),
          ...doc.splitTextToSize(`Fecha: ${formatDateTime24h(git.authorDate) || 'N/A'}`, textMaxWidth),
          ...doc.splitTextToSize(`Commit: ${commitLabel}`, textMaxWidth)
        ];
      }

      const textBlockLines = findingLines.length + fileLines.length + lineLines.length + secretLines.length + gitLines.length;
      const textBlockHeight = textBlockLines * textLineHeight;

      const cardHeight = cardPaddingTop + chipBlockHeight + paragraphTopGap + textBlockHeight + cardPaddingBottom;

      // Nueva página si es necesario
      if (y + cardHeight > 280) {
        doc.addPage();
        y = 20;
      }

      // Dibujar tarjeta
      doc.setFillColor(248, 250, 252);
      const cardY = y;
      doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 2, 2, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 2, 2, 'S');

      // Dibujar chips
      let chipX = chipStartX;
      const chipY = cardY + cardPaddingTop;

      // Agregar numeración por separado (sin fondo de color)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(75, 85, 99);
      doc.text(`${index + 1}.`, chipStartX - 12, chipY + 4.6);
      doc.setTextColor(0, 0, 0);

      chips.forEach(function(chip) {
        drawSectionChip(
          doc,
          chip.text,
          chipX,
          chipY,
          chip.width,
          chipHeight,
          chip.style
        );
        chipX += chip.width + chipGap;
      });

      // Agregar texto
      y = chipY + chipHeight + paragraphTopGap;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      
      findingLines.forEach(function(line) {
        doc.text(line, textX, y);
        y += textLineHeight;
      });
      
      fileLines.forEach(function(line) {
        doc.text(line, textX, y);
        y += textLineHeight;
      });
      
      lineLines.forEach(function(line) {
        doc.text(line, textX, y);
        y += textLineHeight;
      });
      
      secretLines.forEach(function(line) {
        doc.text(line, textX, y);
        y += textLineHeight;
      });
      
      gitLines.forEach(function(line) {
        doc.text(line, textX, y);
        y += textLineHeight;
      });

      y = cardY + cardHeight;

      // Separador entre tarjetas
      if (index < findings.length - 1) {
        y += 3;
        doc.setDrawColor(226, 232, 240);
        doc.line(cardX, y, cardX + cardWidth, y);
        y += 5;
      } else {
        y += cardGap;
      }
    });
  }

  doc.save(getSafePdfName());
}

function fitTerminal(shouldNotifyResize = true) {
  if (!terminal || !fitAddon) return;

  fitAddon.fit();

  if (shouldNotifyResize) {
    sendResize();
  }
}

function ensureTerminal() {
  const terminalContainer = byId('gitleaksTerminalInner');
  if (!terminalContainer) return;

  if (terminal) return;

  if (typeof Terminal === 'undefined') {
    terminalContainer.innerHTML = '<div class="text-danger p-2">xterm.js no está disponible.</div>';
    return;
  }

  terminal = new Terminal({
    convertEol: true,
    cursorBlink: true,
    allowProposedApi: true,
    scrollback: 20000,
    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
    fontSize: 13,
    theme: {
      background: '#0f172a',
      foreground: '#e2e8f0',
      scrollbarSliderBackground: '#4a6080',
      scrollbarSliderHoverBackground: '#5c7599',
      scrollbarSliderActiveBackground: '#6e8ab2'
    }
  });

  if (typeof FitAddon !== 'undefined' && typeof FitAddon.FitAddon === 'function') {
    fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);
  }

  terminal.open(terminalContainer);
  fitTerminal(false);

  if (!terminalInputDisposable) {
    terminalInputDisposable = terminal.onData(function (data) {
      if (socket?.readyState !== 1) return;

      socket.send(JSON.stringify({
        type: 'input',
        data
      }));
    });
  }

  terminal.writeln('Consola lista. Presiona Gitleaks para iniciar.');
}

function getPayload() {
  const projectSelect = byId('selGitleaksProject');
  const excludeGitIgnoredCheckbox = byId('chkExcludeGitIgnored');

  return {
    directory: projectSelect?.value || '',
    excludeGitIgnored: excludeGitIgnoredCheckbox ? !!excludeGitIgnoredCheckbox.checked : true
  };
}

function writeLine(line) {
  if (!terminal) return;
  terminal.write(line);
}

function clearConsole() {
  if (!terminal) return;

  terminal.clear();
  terminal.focus();

  if (socket?.readyState === 1) {
    socket.send(JSON.stringify({
      type: 'input',
      data: '\f'
    }));
    return;
  }

  terminal.write('$ ');
}

function markRunButtonAvailable() {
  const projectSelect = byId('selGitleaksProject');
  const hasDirectory = !!String(projectSelect?.value || '').trim();
  setRunButtonState(!hasDirectory);
}

function getSocketUrl() {
  const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${globalThis.location.host}/ws/gitleaks`;
}

function sendRunGitleaks(payload) {
  if (socket?.readyState !== 1) {
    pendingRunPayload = payload;
    return;
  }

  socket.send(JSON.stringify({
    type: 'runGitleaks',
    payload
  }));
}

function connectSocket() {
  if (socket?.readyState === 0 || socket?.readyState === 1) return;

  socket = new WebSocket(getSocketUrl());

  socket.addEventListener('open', function () {
    writeLine('\r\n[WebSocket conectado]\r\n');
    fitTerminal(true);
    terminal.focus();

    if (pendingRunPayload) {
      const payload = pendingRunPayload;
      pendingRunPayload = null;
      sendRunGitleaks(payload);
    }
  });

  socket.addEventListener('message', function (event) {
    let message = null;

    try {
      message = JSON.parse(event.data);
    } catch {
      writeLine(String(event.data || ''));
      return;
    }

    if (message.type === 'output') {
      writeLine(message.data || '');
      return;
    }

    if (message.type === 'info') {
      writeLine(message.message || '');
      return;
    }

    if (message.type === 'error') {
      writeLine(`\r\n[ERROR] ${message.message || 'Error desconocido'}\r\n`);
      return;
    }

    if (message.type === 'exit') {
      writeLine(`\r\n[Proceso finalizado] código=${message.exitCode}\r\n`);
      return;
    }

    if (message.type === 'report') {
      renderFindingsReport(message.findings || [], message.totalFilesAnalyzed || 0, {
        excludeGitIgnored: message.excludeGitIgnored !== false,
        gitIgnoreMessage: message.gitIgnoreMessage || ''
      });
      openReportModal();
    }
  });

  socket.addEventListener('close', function () {
    markRunButtonAvailable();
    pendingRunPayload = null;
    socket = null;
  });

  socket.addEventListener('error', function () {
    writeLine('\r\n[ERROR] No fue posible abrir la conexión WebSocket.\r\n');
    markRunButtonAvailable();
  });
}

function sendResize() {
  if (!terminal || socket?.readyState !== 1) return;

  socket.send(JSON.stringify({
    type: 'resize',
    cols: terminal.cols,
    rows: terminal.rows
  }));
}

async function runGitleaks() {
  ensureTerminal();
  if (!terminal) return;

  const payload = getPayload();
  if (!payload.directory.trim()) {
    if (typeof Swal !== 'undefined') {
      Swal.fire({ icon: 'warning', title: 'Directorio requerido', text: 'Selecciona un directorio antes de ejecutar Gitleaks.' });
    }
    return;
  }

  setRunButtonState(false);
  setReportButtonState(true);
  setDownloadPdfButtonState(true);

  writeLine('\r\nPreparando ejecución de Gitleaks...\r\n');
  connectSocket();
  sendRunGitleaks(payload);
}
