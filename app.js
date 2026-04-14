/* ========================================
   PROJECT MAP — CLIENT PORTAL
   ======================================== */

(function() {
  'use strict';


  // Apply config colors to ALL CSS custom properties
  // Helper: lighten a hex color by mixing with white
  function lightenColor(hex, amount) {
    var r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
    r = Math.round(r + (255 - r) * amount); g = Math.round(g + (255 - g) * amount); b = Math.round(b + (255 - b) * amount);
    return '#' + [r,g,b].map(function(c) { return c.toString(16).padStart(2,'0'); }).join('');
  }
  // Helper: darken a hex color by mixing with black
  function darkenColor(hex, amount) {
    var r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
    r = Math.round(r * (1 - amount)); g = Math.round(g * (1 - amount)); b = Math.round(b * (1 - amount));
    return '#' + [r,g,b].map(function(c) { return c.toString(16).padStart(2,'0'); }).join('');
  }

  var root = document.documentElement.style;
  var cfg = PORTAL_CONFIG;

  // Core colors from config
  root.setProperty('--primary', cfg.primaryColor);
  root.setProperty('--text', cfg.primaryColor);
  root.setProperty('--in-progress', cfg.primaryColor);

  root.setProperty('--accent', cfg.accentColor);
  root.setProperty('--accent-warm', cfg.accentColor);
  root.setProperty('--accent-warm-light', lightenColor(cfg.accentColor, 0.55));

  root.setProperty('--bg', cfg.backgroundColor);
  root.setProperty('--bg-alt', darkenColor(cfg.backgroundColor, 0.03));
  root.setProperty('--in-progress-bg', darkenColor(cfg.backgroundColor, 0.03));
  root.setProperty('--success-bg', darkenColor(cfg.backgroundColor, 0.03));

  root.setProperty('--surface', cfg.surfaceColor || '#FFFFFF');
  root.setProperty('--surface-hover', darkenColor(cfg.surfaceColor || '#FFFFFF', 0.02));

  root.setProperty('--border', cfg.borderColor);
  root.setProperty('--border-light', lightenColor(cfg.borderColor, 0.3));

  root.setProperty('--text-secondary', cfg.textSecondary);
  root.setProperty('--text-tertiary', lightenColor(cfg.textSecondary, 0.3));
  root.setProperty('--success', cfg.textSecondary);

  // Apply page title from config
  document.title = PORTAL_CONFIG.companyName + ' — ' + PORTAL_CONFIG.tagline;

  // Update favicon dynamically from config — clean initial-based mark
  (function() {
    var initial = (PORTAL_CONFIG.companyName || 'P').charAt(0);
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='4' fill='" + PORTAL_CONFIG.primaryColor + "'/><text x='16' y='22' text-anchor='middle' font-family='Arial,sans-serif' font-size='18' font-weight='700' fill='" + PORTAL_CONFIG.accentColor + "'>" + initial + "</text></svg>";
    var link = document.querySelector("link[rel='icon']");
    if (link) link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  })();

  // Initialize Firebase from config.js
  const app = firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const storage = firebase.storage();

  // Persist auth across browser sessions
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

  // ========================================
  // PHASE DEFINITIONS
  // ========================================

  const PHASE_DEFS = [
    { num: 1, name: 'Design & Planning', desc: 'Architectural drawings, material selections, and project scope finalization.' },
    { num: 2, name: 'Permitting', desc: 'Securing all necessary building permits and regulatory approvals.' },
    { num: 3, name: 'Site Prep & Foundation', desc: 'Grading, excavation, and foundation construction.' },
    { num: 4, name: 'Framing & Structure', desc: 'Structural framing, roof systems, and exterior sheathing.' },
    { num: 5, name: 'Mechanical', desc: 'HVAC, plumbing, and electrical rough-in installation.' },
    { num: 6, name: 'Interior Finishes', desc: 'Drywall, flooring, cabinetry, paint, and fixture installation.' },
    { num: 7, name: 'Exterior & Landscaping', desc: 'Exterior cladding, hardscaping, and landscape installation.' },
    { num: 8, name: 'Final Walkthrough & Closeout', desc: 'Final inspection, punch list completion, and handover.' }
  ];

  // ========================================
  // STATE
  // ========================================

  let currentUser = null;       // Firebase user object
  let userProfile = null;       // Firestore user doc { name, role, email, projectId }
  let appState = 'loading';     // loading | setup | login | forgot | client | admin | employee
  let adminView = 'overview';   // overview | detail | clients | team
  let adminSelectedProject = null;
  let adminPreviewClientView = false;
  let clientView = 'dashboard'; // dashboard | budget | photos | documents | selections | updates
  let showModal = null;         // null | 'addClient' | 'editClient' | 'newProject' | 'editProject' | 'addEmployee'
  let editClientId = null;       // UID of client being edited
  let wizardState = null;       // multi-step new-project wizard state

  // ========================================
  // URL HASH ROUTING (persist view on refresh)
  // ========================================
  // Client tab → hash segment mapping
  var CLIENT_TAB_HASH = {
    dashboard: 'home', finances: 'finances', updates: 'updates',
    changeOrders: 'approvals', selections: 'selections', documents: 'documents', photos: 'photos'
  };
  var CLIENT_HASH_TAB = {};
  Object.keys(CLIENT_TAB_HASH).forEach(function(k) { CLIENT_HASH_TAB[CLIENT_TAB_HASH[k]] = k; });

  // push=true adds a history entry, push=false replaces current entry
  function updateHash(push) {
    var hash = '#';
    if (appState === 'admin') {
      if (adminView === 'detail' && adminSelectedProject) {
        hash = '#project/' + adminSelectedProject + '/' + (adminDetailTab || 'details');
  
      } else {
        hash = '#admin';
      }
    } else if (appState === 'client') {
      hash = '#' + (CLIENT_TAB_HASH[clientView] || 'home');
    } else {
      return;
    }
    if (push) {
      history.pushState(null, '', hash);
    } else {
      history.replaceState(null, '', hash);
    }
  }

  function restoreFromHash() {
    var hash = (location.hash || '').replace('#', '');
    if (appState === 'admin') {
      if (hash.startsWith('project/')) {
        var parts = hash.split('/');
        var pid   = parts[1];
        var tab   = parts[2] || 'details';
        if (!pid) return;
        var project = allProjects.find(function(p) { return p.id === pid; });
        if (!project) return;
        adminSelectedProject = pid;
        adminView = 'detail';
        adminDetailTab = tab;
        firestoreBudgetItems = [];
        budgetLoadedForProject = null;
        currentMessages = [];
      } else if (hash === 'admin') {
        adminView = 'overview';
        adminSelectedProject = null;

      }
    } else if (appState === 'client') {
      if (CLIENT_HASH_TAB[hash]) {
        clientView = CLIENT_HASH_TAB[hash];
      }
    }
  }

  function updateTitle() {
    var base = PORTAL_CONFIG.companyName || 'Project Map';
    var title = base;
    if (appState === 'admin') {
      if (adminView === 'detail' && adminSelectedProject) {
        var proj = allProjects.find(function(p) { return p.id === adminSelectedProject; });
        var projName = proj ? proj.name : 'Project';
        var tabLabels = {
          details: '', phases: 'Timeline', budget: 'Budget',
          updates: 'Updates', photos: 'Photos', documents: 'Documents',
          selections: 'Selections'
        };
        var tabLabel = tabLabels[adminDetailTab] || '';
        title = (tabLabel ? tabLabel + ' — ' : '') + projName + ' | ' + base;
      } else {
        title = 'Admin | ' + base;
      }
    } else if (appState === 'client') {
      var clientProj = allProjects.find(function(p) { return p.clientId === (userProfile && userProfile.id) || p.id === (userProfile && userProfile.projectId); });
      var clientProjName = clientProj ? clientProj.name : '';
      var clientTabLabels = {
        dashboard: 'Home', finances: 'Finances', updates: 'Updates',
        changeOrders: 'Approvals', selections: 'Selections', documents: 'Documents'
      };
      var clientTab = clientTabLabels[clientView] || '';
      title = (clientTab && clientTab !== 'Home' ? clientTab + ' — ' : '') + (clientProjName || base);
      if (clientProjName) title += ' | ' + base;
    }
    document.title = title;
  }

  // Handle browser back / forward buttons
  window.addEventListener('popstate', function() {
    if (appState === 'admin') {
      var prevProject = adminSelectedProject;
      restoreFromHash();
      if (adminSelectedProject !== prevProject) {
        firestoreBudgetItems = [];
        budgetLoadedForProject = null;
        currentMessages = [];
      }
      render();
    } else if (appState === 'client') {
      restoreFromHash();
      render();
    }
  });
  let budgetCategoryOpen = {};  // { '01': true, '05': false } — template budget expand state
  let budgetSaveTimer = null;   // debounce handle for budget input saves
  let budgetLoadedForProject = null; // tracks which projectId has been loaded into firestoreBudgetItems
  let budgetEditingLine = null; // id of line currently in edit mode
  let budgetAddingToCategory = null; // catCode where the add-line form is open
  let cachedTemplate = null;    // master template codes loaded from Firestore for restore
  let cachedTemplateLoading = false;
  let cachedTemplateFailed = false; // prevents infinite retry loop on permission errors
  let editProjectData = null;

  // Admin detail sub-tab
  let adminDetailTab = 'details'; // details | phases | budget | updates | photos | documents | selections

  // Employee state
  let employeeView = 'overview';        // overview | detail
  let employeeSelectedProject = null;
  let employeeDetailTab = 'updates';    // updates | phases | budget | documents | selections

  // Cached Firestore data
  let allProjects = [];
  let allUsers = [];

  // Budget state (legacy Google Sheets - kept for import)
  let budgetData = null;
  let budgetLastSynced = null;
  let budgetLoading = false;
  let budgetFetchError = null;
  let budgetExpandedCategories = {};

  // Firestore budget state
  let firestoreBudgetItems = [];
  let firestoreBudgetLoading = false;
  let editingBudgetItem = null; // null or budget item object for editing
  let showBudgetModal = false;

  // Photos state
  let projectPhotos = [];
  let photosLoading = false;
  let photoFilterPhase = 'all';
  let lightboxPhoto = null;

  // Documents state
  let projectDocuments = [];
  let documentsLoading = false;

  // Selections state
  let projectSelections = [];
  let selectionsLoading = false;
  let showSelectionModal = false;
  let editingSelection = null;

  // Change Orders state
  let currentChangeOrders = [];
  let changeOrdersLoading = false;

  // Signature pad state
  let signaturePad = null;
  let signatureCallback = null; // function to call with signature data when confirmed
  let signatureModalBound = false; // prevent double-binding

  // Messages state
  let currentMessages = [];
  let messagesLoading = false;

  // Invoices state
  let currentInvoices = [];
  let invoicesLoading = false;

  // QuickBooks Online state
  let qboConnected = false;
  let qboCustomers = [];  // cached QBO customer list

  // ========================================
  // UTILS
  // ========================================

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateShort(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatTimestamp(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatTimestampShort(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ========================================
  // SIGNATURE PAD
  // ========================================

  function openSignatureModal(itemName, callback) {
    var modal = document.getElementById('signatureModal');
    var canvas = document.getElementById('signatureCanvas');
    var itemLabel = document.getElementById('signatureItemName');
    if (!modal || !canvas) return;

    itemLabel.textContent = itemName;
    modal.style.display = 'flex';
    signatureCallback = callback;

    // Initialize or reset signature pad
    if (signaturePad) {
      signaturePad.clear();
    } else {
      signaturePad = new SignaturePad(canvas, {
        backgroundColor: 'rgba(250,249,246,1)',
        penColor: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#1a1a1a',
        minWidth: 1,
        maxWidth: 2.5,
      });
    }

    // Resize canvas to actual display size for crisp rendering
    var ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
    signaturePad.clear(); // clear again after resize
  }

  function closeSignatureModal() {
    var modal = document.getElementById('signatureModal');
    if (modal) modal.style.display = 'none';
    signatureCallback = null;
  }

  function bindSignatureModalEvents() {
    if (signatureModalBound) return;
    signatureModalBound = true;
    document.getElementById('signatureClearBtn')?.addEventListener('click', function() {
      if (signaturePad) signaturePad.clear();
    });
    document.getElementById('signatureCancelBtn')?.addEventListener('click', closeSignatureModal);
    document.getElementById('signatureConfirmBtn')?.addEventListener('click', function() {
      if (!signaturePad || signaturePad.isEmpty()) {
        showToast('Please sign before confirming.');
        return;
      }
      var signatureData = signaturePad.toDataURL('image/png');
      if (signatureCallback) signatureCallback(signatureData);
      closeSignatureModal();
    });
  }

  function formatMessageTime(ts) {
    if (!ts) return '';
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    var now = new Date();
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    var timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (d >= startOfToday) {
      return 'Today ' + timeStr;
    } else if (d >= startOfYesterday) {
      return 'Yesterday ' + timeStr;
    } else {
      var dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return dateStr + ', ' + timeStr;
    }
  }

  function getPhaseDef(num) {
    return PHASE_DEFS.find(p => p.num === num) || PHASE_DEFS[0];
  }

  function getProjectProgress(project) {
    if (!project.phases) return 0;
    const completed = project.phases.filter(p => p.status === 'completed').length;
    return Math.round((completed / project.phases.length) * 100);
  }

  function getCurrentPhase(project) {
    if (!project.phases) return null;
    const inProg = project.phases.find(p => p.status === 'in-progress');
    if (inProg) return inProg;
    // If none in progress, find last completed + 1 or first
    const completed = project.phases.filter(p => p.status === 'completed');
    if (completed.length === project.phases.length) return project.phases[project.phases.length - 1];
    if (completed.length === 0) return project.phases[0];
    return project.phases[completed.length];
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  function formatCurrency(num) {
    if (num == null || isNaN(num)) return '$0.00';
    return '$' + Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ========================================
  // EMAIL NOTIFICATIONS
  // ========================================

  async function sendEmailNotification(to, subject, htmlBody) {
    if (!to) return;
    try {
      await db.collection('mail').add({
        to: to,
        message: { subject: subject, html: htmlBody }
      });
    } catch(e) {
      console.error('Email notification failed:', e);
    }
  }

  function buildEmailHtml(projectName, heading, bodyContent) {
    return '<div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:' + PORTAL_CONFIG.primaryColor + ';">' +
      '<div style="background:' + PORTAL_CONFIG.primaryColor + ';padding:20px 24px;">' +
        '<h1 style="margin:0;font-size:18px;font-weight:800;color:' + PORTAL_CONFIG.backgroundColor + ';letter-spacing:0.05em;">' + PORTAL_CONFIG.companyName + '</h1>' +
        '<p style="margin:4px 0 0;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.15em;">' + PORTAL_CONFIG.tagline + '</p>' +
      '</div>' +
      '<div style="padding:24px;background:' + PORTAL_CONFIG.backgroundColor + ';">' +
        '<p style="font-size:11px;color:' + PORTAL_CONFIG.textSecondary + ';text-transform:uppercase;letter-spacing:0.1em;margin:0 0 4px;">' + projectName + '</p>' +
        '<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:' + PORTAL_CONFIG.primaryColor + ';">' + heading + '</h2>' +
        bodyContent +
        '<div style="margin-top:24px;padding-top:16px;border-top:1px solid ' + PORTAL_CONFIG.borderColor + ';">' +
          '<a href="' + PORTAL_CONFIG.portalUrl + '" style="display:inline-block;background:' + PORTAL_CONFIG.primaryColor + ';color:' + PORTAL_CONFIG.backgroundColor + ';padding:10px 24px;text-decoration:none;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;border-radius:4px;">View in Portal</a>' +
        '</div>' +
      '</div>' +
      '<div style="padding:16px 24px;font-size:10px;color:#999;">Sent from ' + PORTAL_CONFIG.companyName + ' ' + PORTAL_CONFIG.tagline + '</div>' +
    '</div>';
  }

  function getClientEmailForProject(project) {
    if (!project || !project.clientId) return null;
    var client = allUsers.find(function(u) { return u.id === project.clientId; });
    return client ? client.email : null;
  }

  function getAdminEmail() {
    var admin = allUsers.find(function(u) { return u.role === 'admin'; });
    return admin ? admin.email : null;
  }

  // ========================================
  // PDF GENERATION
  // ========================================

  function generatePdfHeader(doc, project) {
    const pageWidth = doc.internal.pageSize.getWidth();
    // Dark header bar
    doc.setFillColor(26, 26, 26);
    doc.rect(0, 0, pageWidth, 36, 'F');
    // Company name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(250, 249, 246);
    doc.text(PORTAL_CONFIG.companyName, 14, 16);
    // Subtitle
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(180, 180, 180);
    doc.text(PORTAL_CONFIG.tagline.toUpperCase(), 14, 24);
    // Project name right-aligned
    doc.setFontSize(10);
    doc.setTextColor(250, 249, 246);
    doc.text(project.name || 'Untitled Project', pageWidth - 14, 16, { align: 'right' });
    // Location + date
    doc.setFontSize(7);
    doc.setTextColor(180, 180, 180);
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    doc.text((project.location ? project.location + '  |  ' : '') + dateStr, pageWidth - 14, 24, { align: 'right' });
    return 44; // y position after header
  }

  function downloadBudgetPdf(project) {
    var jsPDF  = window.jspdf.jsPDF;
    var doc    = new jsPDF('portrait', 'mm', 'letter');
    var pw     = doc.internal.pageSize.getWidth();
    var ph     = doc.internal.pageSize.getHeight();
    var ml = 14, mr = 14, cw = pw - ml - mr;
    var accent   = [196, 165, 123];
    var dark     = [26, 26, 26];
    var light    = [180, 180, 180];
    var offWhite = [250, 249, 246];
    var borderC  = [229, 227, 222];
    var y = generatePdfHeader(doc, project);

    // Section label
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor.apply(doc, accent);
    doc.text('BUDGET SUMMARY', ml, y);
    y += 6;

    var items = firestoreBudgetItems || [];
    var subItems = items.filter(function(i) { return i.parent_code !== null && i.parent_code !== undefined || (i.budgetAmount !== undefined); });
    // For old schema: use all items. For new: skip headers (parent_code===null)
    var lineItems = items.filter(function(i) { return i.parent_code !== null; });
    if (lineItems.length === 0) lineItems = items; // old schema fallback

    if (lineItems.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor.apply(doc, light);
      doc.text('No budget items found.', ml, y);
    } else {
      var totalBudget = 0, totalActual = 0;
      lineItems.forEach(function(i) { totalBudget += budgetAmt(i); totalActual += actualAmt(i); });
      var totalVar = totalBudget - totalActual;
      var pct = totalBudget > 0 ? Math.min(100, (totalActual / totalBudget) * 100) : 0;

      // Info grid
      var cells = [
        { label: 'TOTAL BUDGET',  value: formatCurrency(totalBudget), color: dark },
        { label: 'SPENT TO DATE', value: formatCurrency(totalActual), color: dark },
        { label: 'REMAINING',     value: formatCurrency(totalVar),    color: totalVar < 0 ? [153,27,27] : [6,95,70] },
        { label: 'PROGRESS',      value: pct.toFixed(0) + '%',        color: dark }
      ];
      var cellW = cw / 4, cellH = 16;
      doc.setFillColor.apply(doc, offWhite);
      doc.rect(ml, y, cw, cellH, 'F');
      doc.setDrawColor.apply(doc, borderC);
      doc.setLineWidth(0.2);
      doc.rect(ml, y, cw, cellH, 'S');
      cells.forEach(function(cell, i) {
        var cx = ml + i * cellW;
        if (i > 0) { doc.setDrawColor.apply(doc, borderC); doc.line(cx, y, cx, y + cellH); }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor.apply(doc, light);
        doc.text(cell.label, cx + 3, y + 5);
        doc.setFont('helvetica', 'bold');  doc.setFontSize(9); doc.setTextColor.apply(doc, cell.color);
        doc.text(cell.value, cx + 3, y + 12);
      });
      y += cellH + 8;

      // Table
      var cats = {};
      lineItems.forEach(function(item) {
        var cat = item.top_level_name || item.category || 'Uncategorized';
        if (!cats[cat]) cats[cat] = [];
        cats[cat].push(item);
      });
      var tableBody = [];
      Object.keys(cats).sort().forEach(function(cat) {
        tableBody.push([{ content: cat, colSpan: 4, styles: { fillColor: [244,242,238], fontStyle: 'bold', fontSize: 7.5, textColor: [26,26,26] } }]);
        var catB = 0, catA = 0;
        cats[cat].forEach(function(item) {
          var b = budgetAmt(item), a = actualAmt(item), v = b - a;
          catB += b; catA += a;
          tableBody.push([
            item.cost_code ? item.cost_code + '  ' + item.name : (item.costCode || item.description || item.name || ''),
            formatCurrency(b), formatCurrency(a), formatCurrency(v)
          ]);
        });
        tableBody.push([
          { content: 'Subtotal', styles: { fontStyle: 'bold', fillColor: [244,242,238] } },
          { content: formatCurrency(catB), styles: { fontStyle: 'bold', fillColor: [244,242,238] } },
          { content: formatCurrency(catA), styles: { fontStyle: 'bold', fillColor: [244,242,238] } },
          { content: formatCurrency(catB - catA), styles: { fontStyle: 'bold', fillColor: [244,242,238], textColor: (catB-catA)<0?[153,27,27]:[26,26,26] } }
        ]);
      });
      tableBody.push([
        { content: 'TOTAL', styles: { fontStyle:'bold', fillColor:dark, textColor:offWhite } },
        { content: formatCurrency(totalBudget), styles: { fontStyle:'bold', fillColor:dark, textColor:offWhite, halign:'right' } },
        { content: formatCurrency(totalActual), styles: { fontStyle:'bold', fillColor:dark, textColor:offWhite, halign:'right' } },
        { content: formatCurrency(totalVar),    styles: { fontStyle:'bold', fillColor:dark, textColor:offWhite, halign:'right' } }
      ]);

      doc.autoTable({
        startY: y,
        head: [['Item', 'Budget', 'Actual', 'Variance']],
        body: tableBody,
        margin: { left: ml, right: mr },
        styles:     { fontSize: 8, cellPadding: 2.5, font: 'helvetica', textColor: dark },
        headStyles: { fillColor: dark, textColor: offWhite, fontStyle: 'bold', fontSize: 7 },
        columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign:'right', cellWidth:32 }, 2: { halign:'right', cellWidth:32 }, 3: { halign:'right', cellWidth:32 } },
        alternateRowStyles: { fillColor: offWhite },
        theme: 'plain',
        tableLineColor: borderC,
        tableLineWidth: 0.1,
        didParseCell: function(data) {
          if (data.section === 'body' && data.column.index === 3 && typeof data.cell.raw === 'string') {
            var v = parseFloat(data.cell.raw.replace(/[^\d.-]/g,''));
            if (!isNaN(v) && v < 0) data.cell.styles.textColor = [153,27,27];
          }
        }
      });
    }

    // Footer
    var pages = doc.internal.getNumberOfPages();
    for (var i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setDrawColor.apply(doc, borderC); doc.setLineWidth(0.2);
      doc.line(ml, ph - 14, pw - mr, ph - 14);
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor.apply(doc, light);
      doc.text(PORTAL_CONFIG.companyName + '  ·  ' + PORTAL_CONFIG.tagline, ml, ph - 9);
      doc.text('Page ' + i + ' of ' + pages, pw - mr, ph - 9, { align: 'right' });
    }
    var safeName = (project.name || 'Project').replace(/[^a-zA-Z0-9]/g, '_');
    doc.save(safeName + '_Budget_' + new Date().toISOString().slice(0,10) + '.pdf');
    showToast('Budget PDF downloaded.');
  }

  function downloadPhasesPdf(project) {
    var jsPDF  = window.jspdf.jsPDF;
    var doc    = new jsPDF('portrait', 'mm', 'letter');
    var pw     = doc.internal.pageSize.getWidth();
    var ph     = doc.internal.pageSize.getHeight();
    var ml = 14, mr = 14, cw = pw - ml - mr;
    var accent   = [196, 165, 123];
    var dark     = [26, 26, 26];
    var light    = [180, 180, 180];
    var offWhite = [250, 249, 246];
    var borderC  = [229, 227, 222];
    var y = generatePdfHeader(doc, project);

    // Section label
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor.apply(doc, accent);
    doc.text('PROJECT TIMELINE', ml, y);
    y += 6;

    var phases = project.phases || [];
    if (phases.length === 0) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor.apply(doc, light);
      doc.text('No phases defined.', ml, y);
    } else {
      var completed  = phases.filter(function(p) { return p.status === 'completed'; }).length;
      var inProgress = phases.filter(function(p) { return p.status === 'in-progress'; }).length;
      var upcoming   = phases.filter(function(p) { return p.status === 'upcoming'; }).length;
      var pct        = Math.round((completed / phases.length) * 100);

      // Info grid
      var cells = [
        { label: 'COMPLETED',   value: String(completed),   color: [6,95,70]  },
        { label: 'IN PROGRESS', value: String(inProgress),  color: dark       },
        { label: 'UPCOMING',    value: String(upcoming),    color: light      },
        { label: 'PROGRESS',    value: pct + '%',           color: dark       }
      ];
      var cellW = cw / 4, cellH = 16;
      doc.setFillColor.apply(doc, offWhite); doc.rect(ml, y, cw, cellH, 'F');
      doc.setDrawColor.apply(doc, borderC); doc.setLineWidth(0.2); doc.rect(ml, y, cw, cellH, 'S');
      cells.forEach(function(cell, i) {
        var cx = ml + i * cellW;
        if (i > 0) { doc.setDrawColor.apply(doc, borderC); doc.line(cx, y, cx, y + cellH); }
        doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor.apply(doc, light);
        doc.text(cell.label, cx + 3, y + 5);
        doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor.apply(doc, cell.color);
        doc.text(cell.value, cx + 3, y + 13);
      });
      y += cellH + 8;

      // Table
      var tableBody = phases.map(function(phase, i) {
        var s = (phase.status || 'upcoming').replace('-', ' ');
        var sl = s.charAt(0).toUpperCase() + s.slice(1);
        return [
          String(i + 1).padStart(2, '0'),
          phase.name || '',
          sl,
          phase.startDate ? new Date(phase.startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—',
          phase.endDate   ? new Date(phase.endDate   + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
        ];
      });

      doc.autoTable({
        startY: y,
        head: [['#', 'Phase', 'Status', 'Start', 'End']],
        body: tableBody,
        margin: { left: ml, right: mr },
        styles:     { fontSize: 9, cellPadding: 3.5, font: 'helvetica', textColor: dark },
        headStyles: { fillColor: dark, textColor: offWhite, fontStyle: 'bold', fontSize: 7 },
        columnStyles: { 0: { cellWidth: 12, halign: 'center' }, 2: { cellWidth: 26 }, 3: { cellWidth: 32 }, 4: { cellWidth: 32 } },
        alternateRowStyles: { fillColor: offWhite },
        theme: 'plain',
        tableLineColor: borderC,
        tableLineWidth: 0.1,
        didParseCell: function(data) {
          if (data.section === 'body' && data.column.index === 2 && typeof data.cell.raw === 'string') {
            var val = data.cell.raw.toLowerCase();
            if (val === 'completed')  { data.cell.styles.textColor = [6,95,70];  data.cell.styles.fontStyle = 'bold'; }
            else if (val === 'in progress') { data.cell.styles.textColor = dark; data.cell.styles.fontStyle = 'bold'; }
            else { data.cell.styles.textColor = light; }
          }
          // Highlight current phase row
          if (data.section === 'body' && data.row.raw && data.row.raw[2]) {
            var rval = typeof data.row.raw[2] === 'string' ? data.row.raw[2].toLowerCase() : '';
            if (rval === 'in progress') {
              data.cell.styles.fillColor = [248, 245, 240];
            }
          }
        }
      });
    }

    // Footer
    var pages = doc.internal.getNumberOfPages();
    for (var i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setDrawColor.apply(doc, borderC); doc.setLineWidth(0.2);
      doc.line(ml, ph - 14, pw - mr, ph - 14);
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor.apply(doc, light);
      doc.text(PORTAL_CONFIG.companyName + '  ·  ' + PORTAL_CONFIG.tagline, ml, ph - 9);
      doc.text('Page ' + i + ' of ' + pages, pw - mr, ph - 9, { align: 'right' });
    }
    var safeName = (project.name || 'Project').replace(/[^a-zA-Z0-9]/g, '_');
    doc.save(safeName + '_Phases_' + new Date().toISOString().slice(0,10) + '.pdf');
    showToast('Phases PDF downloaded.');
  }

  // Download a single change order as a polished standalone PDF
  function downloadSingleChangeOrderPdf(project, co) {
    try {
      var jsPDF = window.jspdf.jsPDF;
      var doc  = new jsPDF('portrait', 'mm', 'letter');
      var pw   = doc.internal.pageSize.getWidth();   // 215.9
      var ph   = doc.internal.pageSize.getHeight();  // 279.4
      var ml   = 16, mr = 16, cw = pw - ml - mr;    // content width ~184
      var y    = generatePdfHeader(doc, project);

      // Helpers
      var accent  = [196, 165, 123];
      var dark    = [26, 26, 26];
      var mid     = [100, 100, 100];
      var light   = [180, 180, 180];
      var offWhite = [250, 249, 246];
      var borderC  = [229, 227, 222];

      var costNum    = Number(co.costImpact) || 0;
      var costStr    = costNum === 0 ? '$0.00' : ((costNum < 0 ? '−$' : '+$') + Math.abs(costNum).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      var status     = co.status || 'pending';
      var statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

      var fmtDate = function(ts) {
        if (!ts) return '—';
        var d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      };

      // ── Section label ───────────────────────────────────────────────────────────────
      y += 4;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor.apply(doc, accent);
      doc.text('CHANGE ORDER', ml, y);
      y += 6;

      // ── Title ──────────────────────────────────────────────────────────────────────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.setTextColor.apply(doc, dark);
      var titleLines = doc.splitTextToSize(co.title || 'Change Order', cw - 40);
      doc.text(titleLines, ml, y);
      y += titleLines.length * 8 + 4;

      // ── Info grid: 4 cells ──────────────────────────────────────────────────────────────
      var cellW  = cw / 4;
      var cellH  = 16;
      var cells  = [
        { label: 'STATUS', value: statusLabel, color: status === 'approved' ? [6,95,70] : (status === 'denied' ? [153,27,27] : [146,64,14]) },
        { label: 'COST IMPACT', value: costStr,  color: costNum > 0 ? [146,64,14] : (costNum < 0 ? [6,95,70] : dark) },
        { label: 'DATE CREATED',  value: fmtDate(co.createdAt),  color: dark },
        { label: 'DATE RESPONDED', value: fmtDate(co.respondedAt), color: dark }
      ];
      // Light background strip
      doc.setFillColor.apply(doc, offWhite);
      doc.rect(ml, y, cw, cellH, 'F');
      doc.setDrawColor.apply(doc, borderC);
      doc.setLineWidth(0.2);
      doc.rect(ml, y, cw, cellH, 'S');
      cells.forEach(function(cell, i) {
        var cx = ml + i * cellW;
        // Vertical divider
        if (i > 0) { doc.setDrawColor.apply(doc, borderC); doc.line(cx, y, cx, y + cellH); }
        // Label
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6);
        doc.setTextColor.apply(doc, light);
        doc.text(cell.label, cx + 4, y + 5);
        // Value
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor.apply(doc, cell.color);
        doc.text(cell.value, cx + 4, y + 12);
      });
      y += cellH + 10;

      // ── Divider ───────────────────────────────────────────────────────────────────────
      doc.setDrawColor.apply(doc, borderC);
      doc.setLineWidth(0.3);
      doc.line(ml, y, pw - mr, y);
      y += 8;

      // ── Text block helper ─────────────────────────────────────────────────────────────────
      var drawSection = function(label, text) {
        if (!text) return;
        // Accent left bar
        doc.setFillColor.apply(doc, accent);
        doc.rect(ml, y, 2, 4, 'F');
        // Label
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor.apply(doc, accent);
        doc.text(label, ml + 5, y + 3.5);
        y += 8;
        // Body text in a light box
        var lines   = doc.splitTextToSize(text, cw - 8);
        var boxH    = lines.length * 4.5 + 10;
        doc.setFillColor.apply(doc, offWhite);
        doc.rect(ml, y, cw, boxH, 'F');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor.apply(doc, dark);
        doc.text(lines, ml + 4, y + 7);
        y += boxH + 8;
      };

      drawSection('SCOPE OF WORK', co.description);
      drawSection('CLIENT RESPONSE', co.responseNote);

      // ── Signature block ────────────────────────────────────────────────────────────────
      if (co.signature) {
        if (y + 48 > ph - 20) { doc.addPage(); y = 20; }
        // Label
        doc.setFillColor.apply(doc, accent);
        doc.rect(ml, y, 2, 4, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor.apply(doc, accent);
        doc.text('CLIENT SIGNATURE', ml + 5, y + 3.5);
        y += 10;
        // Signature box
        var sigBoxW = 90, sigBoxH = 26;
        doc.setFillColor.apply(doc, offWhite);
        doc.setDrawColor.apply(doc, borderC);
        doc.setLineWidth(0.2);
        doc.rect(ml, y, sigBoxW, sigBoxH, 'FD');
        try { doc.addImage(co.signature, 'PNG', ml + 4, y + 3, 60, 18); } catch(e) {}
        // Signer name + date to the right
        var sigMeta1 = co.signedBy || '';
        var sigMeta2 = co.signedAt ? fmtDate(co.signedAt) : '';
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor.apply(doc, dark);
        if (sigMeta1) doc.text(sigMeta1, ml + sigBoxW + 6, y + 11);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor.apply(doc, mid);
        if (sigMeta2) doc.text(sigMeta2, ml + sigBoxW + 6, y + 18);
        y += sigBoxH + 10;
      }

      // ── Footer ───────────────────────────────────────────────────────────────────────
      var fp = ph - 10;
      doc.setDrawColor.apply(doc, borderC);
      doc.setLineWidth(0.2);
      doc.line(ml, fp - 4, pw - mr, fp - 4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor.apply(doc, light);
      doc.text(PORTAL_CONFIG.companyName + '  ·  ' + PORTAL_CONFIG.tagline, ml, fp);
      doc.text(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), pw - mr, fp, { align: 'right' });

      var safeName  = (project.name || 'Project').replace(/[^a-zA-Z0-9]/g, '_');
      var safeTitle = (co.title || 'ChangeOrder').replace(/[^a-zA-Z0-9]/g, '_');
      doc.save(safeName + '_' + safeTitle + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
      showToast('PDF downloaded.');
    } catch(e) {
      console.error('[PDF] Error:', e);
      showToast('Could not generate PDF: ' + (e.message || 'unknown error'));
    }
  }

  function downloadChangeOrdersPdf(project) {
    if (!window.jspdf) { showToast('PDF library not loaded. Please refresh and try again.'); return; }
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF('portrait', 'mm', 'letter');
    var y = generatePdfHeader(doc, project);

    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(196, 165, 123);
    doc.text('CHANGE ORDERS', 14, y);
    y += 6;

    var orders = currentChangeOrders || [];
    if (orders.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text('No change orders found.', 14, y);
    } else {
      var tableBody = orders.map(function(co, i) {
        var costNum = Number(co.costImpact) || 0;
        var costStr = costNum === 0 ? '$0.00' : (costNum < 0 ? '-$' + Math.abs(costNum).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '+$' + costNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        var statusLabel = (co.status || 'pending').charAt(0).toUpperCase() + (co.status || 'pending').slice(1);
        var dateCreated = co.createdAt ? (co.createdAt.toDate ? co.createdAt.toDate() : new Date(co.createdAt)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
        var responseStr = '';
        if (co.respondedAt) {
          var rd = co.respondedAt.toDate ? co.respondedAt.toDate() : new Date(co.respondedAt);
          responseStr = rd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          if (co.responseNote) responseStr += ': ' + co.responseNote;
        }
        return [
          String(i + 1).padStart(2, '0'),
          (co.title || '') + (co.description ? '\n' + co.description.substring(0, 80) : ''),
          costStr,
          statusLabel,
          dateCreated,
          responseStr
        ];
      });

      // Summary row
      var approvedTotal = 0;
      orders.forEach(function(co) { if (co.status === 'approved') approvedTotal += Number(co.costImpact) || 0; });
      var totalStr = approvedTotal === 0 ? '$0.00' : (approvedTotal < 0 ? '-$' + Math.abs(approvedTotal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '+$' + approvedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      tableBody.push([
        { content: 'TOTAL APPROVED IMPACT', colSpan: 2, styles: { fontStyle: 'bold', fillColor: [26, 26, 26], textColor: [250, 249, 246] } },
        { content: totalStr, styles: { fontStyle: 'bold', fillColor: [26, 26, 26], textColor: [250, 249, 246] } },
        { content: '', styles: { fillColor: [26, 26, 26] } },
        { content: '', styles: { fillColor: [26, 26, 26] } },
        { content: '', styles: { fillColor: [26, 26, 26] } }
      ]);

      doc.autoTable({
        startY: y,
        head: [['#', 'Title / Description', 'Cost Impact', 'Status', 'Date', 'Response']],
        body: tableBody,
        margin: { left: 14, right: 14 },
        styles: { fontSize: 8, cellPadding: 2.5, font: 'helvetica', textColor: [26, 26, 26] },
        headStyles: { fillColor: [26, 26, 26], textColor: [250, 249, 246], fontStyle: 'bold', fontSize: 7 },
        columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 2: { cellWidth: 24, halign: 'right' }, 3: { cellWidth: 20 }, 4: { cellWidth: 24 } },
        alternateRowStyles: { fillColor: [250, 249, 246] },
        theme: 'plain',
        tableLineColor: [229, 227, 222],
        tableLineWidth: 0.1,
        didParseCell: function(data) {
          if (data.section === 'body' && data.column.index === 3) {
            var raw = data.cell.raw;
            var val = typeof raw === 'string' ? raw.toLowerCase() : '';
            if (val === 'approved') { data.cell.styles.textColor = [6, 95, 70]; data.cell.styles.fontStyle = 'bold'; }
            else if (val === 'denied') { data.cell.styles.textColor = [153, 27, 27]; data.cell.styles.fontStyle = 'bold'; }
            else { data.cell.styles.textColor = [146, 64, 14]; }
          }
        }
      });

      // Add signature images for approved COs
      var signedOrders = orders.filter(function(co) { return co.status === 'approved' && co.signature; });
      if (signedOrders.length > 0) {
        var sigY = doc.lastAutoTable.finalY + 12;
        var pageH = doc.internal.pageSize.getHeight();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(26, 26, 26);
        doc.text('CLIENT SIGNATURES', 14, sigY);
        sigY += 6;
        signedOrders.forEach(function(co, idx) {
          // Each signature block needs ~30mm; add new page if needed
          if (sigY + 30 > pageH - 16) {
            doc.addPage();
            sigY = 20;
          }
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(26, 26, 26);
          doc.text((co.title || 'Change Order'), 14, sigY);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(100, 100, 100);
          var sigMeta = (co.signedBy || '') + (co.signedAt ? '  —  ' + (co.signedAt.toDate ? co.signedAt.toDate() : new Date(co.signedAt)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
          doc.text(sigMeta, 14, sigY + 4);
          try {
            doc.addImage(co.signature, 'PNG', 14, sigY + 7, 50, 14);
          } catch(e) { /* skip if image fails */ }
          doc.setDrawColor(229, 227, 222);
          doc.line(14, sigY + 23, 64, sigY + 23);
          sigY += 30;
        });
      }
    }

    var pages = doc.internal.getNumberOfPages();
    var ph2 = doc.internal.pageSize.getHeight(), pw2 = doc.internal.pageSize.getWidth();
    for (var i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setDrawColor(229,227,222); doc.setLineWidth(0.2);
      doc.line(14, ph2 - 14, pw2 - 14, ph2 - 14);
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(180,180,180);
      doc.text(PORTAL_CONFIG.companyName + '  ·  ' + PORTAL_CONFIG.tagline, 14, ph2 - 9);
      doc.text('Page ' + i + ' of ' + pages, pw2 - 14, ph2 - 9, { align: 'right' });
    }

    var safeName = (project.name || 'Project').replace(/[^a-zA-Z0-9]/g, '_');
    doc.save(safeName + '_ChangeOrders_' + new Date().toISOString().slice(0, 10) + '.pdf');
    showToast('Change Orders PDF downloaded.');
  }

  // ========================================
  // FIREBASE DATA OPERATIONS
  // ========================================

  // Reads the publicly-readable settings/portal doc to check if an admin has been created.
  // Falls back to showing setup (true) on error so a fresh install still works.
  async function checkAdminInitialized() {
    try {
      const portalDoc = await db.collection('settings').doc('portal').get();
      return portalDoc.exists && portalDoc.data().adminInitialized === true;
    } catch (e) {
      console.error('Error checking admin status:', e);
      return false; // Default to NOT initialized (show setup) on error
    }
  }

  async function createAdminAccount(email, password, name) {
    let cred;
    let isNewAccount = true;
    try {
      cred = await auth.createUserWithEmailAndPassword(email, password);
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        // Admin already exists in Auth — just sign in
        cred = await auth.signInWithEmailAndPassword(email, password);
        isNewAccount = false;
      } else {
        throw err;
      }
    }
    if (isNewAccount) {
      await db.collection('users').doc(cred.user.uid).set({
        email: email,
        name: name,
        role: 'admin',
        projectId: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    // Mark portal as admin-initialized — this is the publicly-readable flag
    // that lets unauthenticated users know to show login instead of setup.
    await db.collection('settings').doc('portal').set({ adminInitialized: true }, { merge: true });
    return cred.user;
  }

  async function getUserProfile(uid) {
    const doc = await db.collection('users').doc(uid).get();
    if (doc.exists) return { id: doc.id, ...doc.data() };
    return null;
  }

  async function loadAllProjects() {
    const snap = await db.collection('projects').orderBy('createdAt', 'desc').get();
    allProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function loadAllUsers() {
    const snap = await db.collection('users').get();
    allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function createProject(data) {
    const defaultPhases = PHASE_DEFS.map((p, i) => ({
      name: p.name,
      status: i === 0 ? 'in-progress' : 'upcoming',
      startDate: '',
      endDate: '',
      description: p.desc
    }));

    const docRef = await db.collection('projects').add({
      name: data.name,
      location: data.location,
      clientId: data.clientId || '',
      clientName: data.clientName || '',
      startDate: data.startDate || '',
      estCompletion: data.estCompletion || '',
      googleSheetUrl: data.googleSheetUrl || '',
      heroImageUrl: data.heroImageUrl || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      phases: defaultPhases
    });

    // If client assigned, update their profile
    if (data.clientId) {
      await db.collection('users').doc(data.clientId).update({ projectId: docRef.id });
    }

    return docRef.id;
  }

  async function updateProject(projectId, data) {
    await db.collection('projects').doc(projectId).update(data);
  }

  // ========================================
  // COST CODE TEMPLATE — UPLOAD & SEEDING
  // ========================================

  // Upload master template from hosted JSON to Firestore (run once, admin only)
  async function uploadCostCodeTemplate() {
    try {
      const resp = await fetch('/cost-code-template.json');
      if (!resp.ok) throw new Error('Could not load template file: ' + resp.status);
      const records = await resp.json();

      const batch = db.batch();
      const metaRef = db.collection('costCodeTemplates').doc('master_v1');
      const codesRef = metaRef.collection('codes');

      batch.set(metaRef, {
        version:      '1.0',
        record_count: records.length,
        created_at:   firebase.firestore.FieldValue.serverTimestamp(),
        updated_at:   firebase.firestore.FieldValue.serverTimestamp()
      });

      records.forEach(function(r) {
        batch.set(codesRef.doc(r.cost_code), r);
      });

      await batch.commit();
      console.log('[CostCode] Template uploaded: ' + records.length + ' records');
      return true;
    } catch (e) {
      console.error('[CostCode] Upload failed:', e);
      return false;
    }
  }

  // Check if template exists; auto-upload if not
  async function ensureCostCodeTemplate() {
    try {
      const doc = await db.collection('costCodeTemplates').doc('master_v1').get();
      if (!doc.exists) {
        console.log('[CostCode] Template not found — uploading now...');
        await uploadCostCodeTemplate();
      }
    } catch (e) {
      console.warn('[CostCode] Could not verify template:', e);
    }
  }

  // Seed a project’s budgetItems from the master template
  async function seedProjectBudget(projectId, options) {
    // options: { tier, project_type, contract_type, modules[], include_remodel_conditions }
    try {
      const snap = await db.collection('costCodeTemplates')
        .doc('master_v1').collection('codes').get();

      if (snap.empty) {
        console.warn('[CostCode] Template empty — cannot seed');
        return 0;
      }

      const batch = db.batch();
      const budgetRef = db.collection('projects').doc(projectId).collection('budgetItems');
      let count = 0;

      snap.forEach(function(doc) {
        var r = doc.data();

        // 1 — tier filter
        if (!r.tiers || r.tiers.indexOf(options.tier) === -1) return;

        // 2 — project type filter
        if (!r.project_types || r.project_types.indexOf(options.project_type) === -1) return;

        // 3 — module gate
        if (r.module !== null && r.module !== undefined) {
          if (!options.modules || options.modules.indexOf(r.module) === -1) return;
        }

        // 4 — remodel conditions gate
        if (r.top_level_category === '26') {
          if (!options.include_remodel_conditions) return;
        }

        batch.set(budgetRef.doc(), {
          cost_code:          r.cost_code,
          parent_code:        r.parent_code || null,
          name:               r.name,
          description:        r.description || '',
          sort_order:         r.sort_order || 0,
          top_level_category: r.top_level_category,
          top_level_name:     r.top_level_name,
          cost_type:          r.cost_type || 'subcontractor',
          help_text:          r.help_text || null,
          client_visible:     r.client_visible === true,
          billable:           r.billable !== false,
          is_allowance:       r.is_allowance === true,
          is_selection:       r.is_selection === true,
          is_change_order:    r.is_change_order === true,
          is_contingency:     r.is_contingency === true,
          fee_bucket:         r.fee_bucket || 'none',
          active:             r.active_by_default !== false,
          contract_type:      options.contract_type,
          project_type:       options.project_type,
          budget_amount:      null,
          actual_amount:      null,
          labor_amount:       null,
          material_amount:    null,
          sub_amount:         null,
          markup_pct:         null,
          allowance_amount:   null,
          selection_status:   r.is_allowance ? 'not_started' : null,
          vendor:             null,
          owner_selected:     false,
          notes:              null,
          status:             'not_started',
          seeded_from:        'master_v1',
          created_at:         firebase.firestore.FieldValue.serverTimestamp(),
          updated_at:         firebase.firestore.FieldValue.serverTimestamp()
        });
        count++;
      });

      // Save template settings on project document
      batch.update(db.collection('projects').doc(projectId), {
        budget_template_version:      'master_v1',
        budget_tier:                  options.tier,
        budget_project_type:          options.project_type,
        budget_contract_type:         options.contract_type,
        budget_modules:               options.modules || [],
        budget_remodel_conditions:    options.include_remodel_conditions === true,
        budget_seeded_at:             firebase.firestore.FieldValue.serverTimestamp(),
        budget_seeded_count:          count
      });

      await batch.commit();
      console.log('[CostCode] Seeded ' + count + ' records into project ' + projectId);
      return count;
    } catch (e) {
      console.error('[CostCode] Seeding failed:', e);
      return 0;
    }
  }

  // ========================================
  // PROJECT CREATION WIZARD STATE HELPERS
  // ========================================

  function wizardDefaultState() {
    return {
      step: 1,
      name: '', location: '', clientId: '', startDate: '', estCompletion: '', googleSheetUrl: '',
      project_type: '',
      contract_type: 'cost_plus',
      tier: 'standard',
      include_remodel_conditions: true,
      modules: []
    };
  }

  function wizardNeedsRemodel() {
    return wizardState && (wizardState.project_type === 'remodel' || wizardState.project_type === 'addition');
  }

  function wizardTotalSteps() {
    return wizardNeedsRemodel() ? 7 : 6;
  }

  function wizardDisplayStep(step) {
    // Skips step 4 display count when project type doesn't need remodel conditions
    if (!wizardNeedsRemodel() && step >= 4) return step - 1;
    return step;
  }

  function wizardIsLastStep(step) {
    return step === 7 || (!wizardNeedsRemodel() && step === 6);
  }

  function wizardNextStepNum(step) {
    // Skip step 4 for non-remodel projects
    if (step === 3 && !wizardNeedsRemodel()) return 5;
    return step + 1;
  }

  function wizardPrevStepNum(step) {
    // Skip step 4 going back for non-remodel projects
    if (step === 5 && !wizardNeedsRemodel()) return 3;
    return step - 1;
  }

  async function createClientAccount(email, name) {
    // Create client via secondary Firebase app (avoids logging out the admin)
    let secondaryApp;
    try {
      secondaryApp = firebase.app('secondary');
    } catch(e) {
      secondaryApp = firebase.initializeApp(FIREBASE_CONFIG, 'secondary');
    }
    const secondaryAuth = secondaryApp.auth();

    // Generate random temp password (client will set their own via welcome email)
    const tempPassword = 'PM_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const cred = await secondaryAuth.createUserWithEmailAndPassword(email, tempPassword);
    const newUid = cred.user.uid;

    // Create Firestore profile
    await db.collection('users').doc(newUid).set({
      email: email,
      name: name,
      role: 'client',
      projectId: '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Sign out from secondary app
    await secondaryAuth.signOut();

    // Send branded welcome email via Cloud Function
    // (generates real password reset link server-side + sends polished HTML email)
    try {
      var sendWelcomeEmail = firebase.functions().httpsCallable('sendWelcomeEmail');
      await sendWelcomeEmail({
        clientName: name,
        clientEmail: email,
        companyName: PORTAL_CONFIG.companyName,
        accentColor: PORTAL_CONFIG.accentColor,
        portalUrl: PORTAL_CONFIG.portalUrl || window.location.origin,
        supportEmail: PORTAL_CONFIG.supportEmail
      });
    } catch (welcomeErr) {
      // Non-fatal: account was created, but email failed. Fall back to generic Firebase email.
      console.warn('Welcome email failed, falling back to Firebase reset:', welcomeErr.message);
      await auth.sendPasswordResetEmail(email, {
        url: PORTAL_CONFIG.portalUrl || window.location.origin
      });
    }

    return newUid;
  }

  async function createEmployeeAccount(email, password, name, assignedProjects) {
    let secondaryApp;
    try {
      secondaryApp = firebase.app('secondary');
    } catch(e) {
      secondaryApp = firebase.initializeApp(FIREBASE_CONFIG, 'secondary');
    }
    const secondaryAuth = secondaryApp.auth();

    const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
    const newUid = cred.user.uid;

    await db.collection('users').doc(newUid).set({
      email: email,
      name: name,
      role: 'employee',
      assignedProjects: assignedProjects || [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await secondaryAuth.signOut();

    return newUid;
  }

  // ========================================
  // FIRESTORE BUDGET OPERATIONS
  // ========================================

  async function loadBudgetItems(projectId) {
    firestoreBudgetLoading = true;
    render();
    try {
      // No orderBy — new schema uses sort_order (snake_case), old schema uses sortOrder (camelCase).
      // Firestore orderBy silently excludes docs missing the field, so we sort in JS instead.
      const snap = await db.collection('projects').doc(projectId)
        .collection('budgetItems').get();
      firestoreBudgetItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort: new schema by sort_order, old schema by sortOrder
      firestoreBudgetItems.sort(function(a, b) {
        var sa = a.sort_order !== undefined ? a.sort_order : (a.sortOrder || 0);
        var sb = b.sort_order !== undefined ? b.sort_order : (b.sortOrder || 0);
        return sa - sb;
      });
    } catch (err) {
      console.error('Error loading budget items:', err);
      firestoreBudgetItems = [];
    }
    firestoreBudgetLoading = false;
    budgetLoadedForProject = projectId;
    render();
  }

  async function addBudgetItem(projectId, data) {
    const maxSort = firestoreBudgetItems.reduce((m, i) => Math.max(m, i.sortOrder || 0), 0);
    await db.collection('projects').doc(projectId).collection('budgetItems').add({
      costCode: data.costCode,
      description: data.description || '',
      vendor: data.vendor || '',
      budgetAmount: Number(data.budgetAmount) || 0,
      actualAmount: Number(data.actualAmount) || 0,
      status: data.status || 'pending',
      category: data.category || '',
      notes: data.notes || '',
      sortOrder: maxSort + 1,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  async function updateBudgetItem(projectId, itemId, data) {
    await db.collection('projects').doc(projectId).collection('budgetItems').doc(itemId).update({
      costCode: data.costCode,
      description: data.description || '',
      vendor: data.vendor || '',
      budgetAmount: Number(data.budgetAmount) || 0,
      actualAmount: Number(data.actualAmount) || 0,
      status: data.status || 'pending',
      category: data.category || '',
      notes: data.notes || ''
    });
  }

  async function deleteBudgetItem(projectId, itemId) {
    await db.collection('projects').doc(projectId).collection('budgetItems').doc(itemId).delete();
  }

  async function importBudgetFromSheets(projectId) {
    // Get the project's Google Sheet URL from Firestore
    const project = allProjects.find(p => p.id === projectId);
    const gvizUrl = project && project.googleSheetUrl ? getGvizUrl(project.googleSheetUrl) : null;
    if (!gvizUrl) throw new Error('No Google Sheet URL set for this project. Add one in the Details tab.');

    let items = [];
    try {
      const response = await fetch(gvizUrl);
      if (!response.ok) throw new Error('Fetch failed');
      const text = await response.text();
      const parsed = parseGvizResponse(text);
      if (parsed && parsed.length > 0) {
        // Convert parsed categories to flat budget items
        let sortOrder = 0;
        parsed.forEach(cat => {
          cat.subItems.forEach(item => {
            sortOrder++;
            items.push({
              costCode: item.description || '',
              description: '',
              vendor: item.vendor || '',
              budgetAmount: Number(item.budget) || 0,
              actualAmount: Number(item.actual) || 0,
              status: (item.status === '100%' || item.status === '100' || item.status === '1') ? 'complete' : (item.actual > 0 ? 'in-progress' : 'pending'),
              category: cat.name || '',
              notes: item.notes || '',
              sortOrder: sortOrder,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          });
        });
      }
    } catch (e) {
      console.warn('Could not fetch from Google Sheets, using demo data:', e.message);
      // Fall back to demo data
      const demoCategories = parseDemoDataToCategories(DEMO_BUDGET_DATA);
      let sortOrder = 0;
      demoCategories.forEach(cat => {
        cat.subItems.forEach(item => {
          sortOrder++;
          items.push({
            costCode: item.description || '',
            description: '',
            vendor: item.vendor || '',
            budgetAmount: Number(item.budget) || 0,
            actualAmount: Number(item.actual) || 0,
            status: (item.status === '100%' || item.status === '100' || item.status === '1') ? 'complete' : (item.actual > 0 ? 'in-progress' : 'pending'),
            category: cat.name || '',
            notes: item.notes || '',
            sortOrder: sortOrder,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
      });
    }

    if (items.length === 0) throw new Error('No data found to import');

    // Batch write to Firestore
    const batch = db.batch();
    items.forEach(item => {
      const ref = db.collection('projects').doc(projectId).collection('budgetItems').doc();
      batch.set(ref, item);
    });
    await batch.commit();
    return items.length;
  }

  function getFirestoreBudgetTotals() {
    let totalBudget = 0, totalActual = 0;
    let totalItems = firestoreBudgetItems.length;
    let completed = 0, overBudget = 0, onTrack = 0;

    firestoreBudgetItems.forEach(item => {
      totalBudget += Number(item.budgetAmount) || 0;
      totalActual += Number(item.actualAmount) || 0;
      if (item.status === 'complete') completed++;
      const actual = Number(item.actualAmount) || 0;
      const budget = Number(item.budgetAmount) || 0;
      if (actual > budget && actual > 0) overBudget++;
      else if (budget > 0) onTrack++;
    });

    return {
      budget: totalBudget,
      actual: totalActual,
      variance: totalBudget - totalActual,
      totalItems, completed, overBudget, onTrack
    };
  }

  function groupBudgetItemsByCategory() {
    const groups = {};
    firestoreBudgetItems.forEach(item => {
      const cat = item.category || 'Uncategorized';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return groups;
  }


  // ========================================
  // PHOTOS OPERATIONS
  // ========================================

  async function loadPhotos(projectId) {
    photosLoading = true;
    render();
    try {
      const snap = await db.collection('projects').doc(projectId)
        .collection('photos').orderBy('uploadedAt', 'desc').get();
      projectPhotos = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    } catch (err) {
      console.error('Error loading photos:', err);
      projectPhotos = [];
    }
    photosLoading = false;
    render();
  }

  async function convertHeicIfNeeded(file) {
    var name = file.name.toLowerCase();
    if (name.endsWith('.heic') || name.endsWith('.heif')) {
      var blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
      var newName = file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
      return new File([blob], newName, { type: 'image/jpeg' });
    }
    return file;
  }

  async function uploadPhoto(projectId, file, caption, phase) {
    file = await convertHeicIfNeeded(file);
    var storageRef = storage.ref().child('projects/' + projectId + '/photos/' + Date.now() + '_' + file.name);
    var snapshot = await storageRef.put(file);
    var url = await snapshot.ref.getDownloadURL();
    await db.collection('projects').doc(projectId).collection('photos').add({
      filename: file.name,
      url: url,
      caption: caption || file.name,
      phase: phase || '',
      uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return url;
  }

  async function deletePhoto(projectId, photoId) {
    var photoDoc = await db.collection('projects').doc(projectId).collection('photos').doc(photoId).get();
    if (photoDoc.exists) {
      var data = photoDoc.data();
      if (data.url) {
        try { await storage.refFromURL(data.url).delete(); } catch(e) { console.warn('Could not delete file from storage:', e); }
      }
      await db.collection('projects').doc(projectId).collection('photos').doc(photoId).delete();
    }
  }

  // ========================================
  // INVOICES OPERATIONS
  // ========================================

  async function loadInvoices(projectId) {
    invoicesLoading = true;
    render();
    try {
      var snap = await db.collection('projects').doc(projectId)
        .collection('invoices').orderBy('createdAt', 'desc').get();
      currentInvoices = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    } catch (err) {
      console.error('Error loading invoices:', err);
      currentInvoices = [];
    }
    invoicesLoading = false;
    render();
  }

  async function addInvoice(projectId, data) {
    await db.collection('projects').doc(projectId).collection('invoices').add({
      title: data.title || '',
      amount: Number(data.amount) || 0,
      status: data.status || 'pending',
      dueDate: data.dueDate || '',
      invoiceUrl: data.invoiceUrl || '',
      notes: data.notes || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  async function updateInvoiceStatus(projectId, invoiceId, newStatus) {
    await db.collection('projects').doc(projectId).collection('invoices').doc(invoiceId).update({
      status: newStatus
    });
  }

  async function deleteInvoice(projectId, invoiceId) {
    await db.collection('projects').doc(projectId).collection('invoices').doc(invoiceId).delete();
  }

  function getInvoicesSummary() {
    var totalInvoiced = 0;
    var totalPaid = 0;
    currentInvoices.forEach(function(inv) {
      var amt = Number(inv.amount) || 0;
      totalInvoiced += amt;
      if (inv.status === 'paid') totalPaid += amt;
    });
    return {
      totalInvoiced: totalInvoiced,
      totalPaid: totalPaid,
      totalOutstanding: totalInvoiced - totalPaid
    };
  }

  function renderInvoiceStatusBadge(status) {
    var s = (status || 'pending').toLowerCase();
    var cls = 'invoice-status-' + s;
    var label = s.charAt(0).toUpperCase() + s.slice(1);
    return '<span class="' + cls + '">' + label + '</span>';
  }

  function formatCurrency(amount) {
    var num = Number(amount) || 0;
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderInvoicesSummaryBar() {
    var s = getInvoicesSummary();
    var pctPaid = s.totalInvoiced > 0 ? (s.totalPaid / s.totalInvoiced * 100) : 0;
    var html = '<div class="finances-kpi-row">';
    html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Total Invoiced</div><div class="finances-kpi-value">' + formatCurrency(s.totalInvoiced) + '</div></div>';
    html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Total Paid</div><div class="finances-kpi-value ' + (s.totalPaid > 0 ? 'positive' : '') + '">' + formatCurrency(s.totalPaid) + '</div></div>';
    html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Outstanding</div><div class="finances-kpi-value ' + (s.totalOutstanding > 0 ? 'negative' : '') + '">' + formatCurrency(s.totalOutstanding) + '</div></div>';
    html += '<div class="finances-kpi-item"><div class="finances-kpi-label">% Paid</div><div class="finances-kpi-value">' + pctPaid.toFixed(1) + '%</div></div>';
    html += '</div>';
    return html;
  }

  // ========================================
  // MESSAGES OPERATIONS
  // ========================================

  async function loadMessages(projectId) {
    messagesLoading = true;
    render();
    try {
      var snap = await db.collection('projects').doc(projectId)
        .collection('messages').orderBy('createdAt', 'asc').get();
      currentMessages = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    } catch (err) {
      console.error('Error loading messages:', err);
      currentMessages = [];
    }
    messagesLoading = false;
    render();
    setTimeout(function() {
      var thread = document.querySelector('.messages-thread');
      if (thread) thread.scrollTo(0, 999999);
    }, 50);
  }

  async function sendMessage(projectId, msgData) {
    // msgData: { text, photos (File[]), files (File[]), updateType, title }
    if (!msgData.text || !msgData.text.trim()) return;
    var senderName = (userProfile && userProfile.name) ? userProfile.name : 'Unknown';
    var senderRole = (userProfile && userProfile.role) ? userProfile.role : 'client';
    var senderUid = currentUser ? currentUser.uid : '';

    // Upload photos
    var photoUrls = [];
    if (msgData.photos && msgData.photos.length > 0) {
      for (var pi = 0; pi < msgData.photos.length; pi++) {
        var pFile = await convertHeicIfNeeded(msgData.photos[pi]);
        var pRef = storage.ref().child('projects/' + projectId + '/updates/' + Date.now() + '_' + pFile.name);
        var pSnap = await pRef.put(pFile);
        var pUrl = await pSnap.ref.getDownloadURL();
        photoUrls.push(pUrl);
      }
    }

    // Upload file attachments
    var fileObjs = [];
    if (msgData.files && msgData.files.length > 0) {
      for (var fi = 0; fi < msgData.files.length; fi++) {
        var aFile = msgData.files[fi];
        var aRef = storage.ref().child('projects/' + projectId + '/update-files/' + Date.now() + '_' + aFile.name);
        var aSnap = await aRef.put(aFile);
        var aUrl = await aSnap.ref.getDownloadURL();
        fileObjs.push({ name: aFile.name, url: aUrl, type: aFile.type || '' });
      }
    }

    var doc = {
      text: msgData.text.trim(),
      senderName: senderName,
      senderRole: senderRole,
      senderUid: senderUid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (photoUrls.length > 0) doc.photos = photoUrls;
    if (fileObjs.length > 0) doc.files = fileObjs;
    if (msgData.updateType && msgData.updateType !== 'General') doc.updateType = msgData.updateType;
    if (msgData.title && msgData.title.trim()) doc.title = msgData.title.trim();

    await db.collection('projects').doc(projectId).collection('messages').add(doc);
  }

  function renderUpdatesTab(project, viewerRole) {
    // viewerRole: 'admin' | 'client' | 'employee'
    var headerHtml = viewerRole === 'client'
      ? '<div class="finances-page-header"><div class="finances-page-title">UPDATES</div><div class="finances-page-subtitle">' + escapeHtml(project ? project.name : '') + '</div></div>'
      : '<div class="budget-page-header"><h2 class="budget-page-title">Updates</h2><p class="budget-page-subtitle">' + escapeHtml(project ? project.name : '') + '</p></div>';
    var html = headerHtml + '<div class="admin-section">';
    if (messagesLoading) {
      html += '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading updates...</span></div>';
      html += '</div>';
      return html;
    }
    html += '<div class="messages-container">';
    html += '<div class="messages-thread" id="messagesThread">';
    if (currentMessages.length === 0) {
      if (viewerRole === 'client') {
        html += '<div class="empty-state"><div class="empty-state-icon">PM</div><div class="empty-state-title">Start the Conversation</div><div class="empty-state-message">Use Updates to send messages, questions, or photos directly to your builder.</div></div>';
      } else {
        html += '<div class="finances-invoices-empty" style="padding:48px 24px;"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Updates Yet</div><div class="finances-invoices-empty-msg">Send a message below to start the thread with your client.</div></div>';
      }
    } else {
      currentMessages.forEach(function(msg) {
        var isSent = msg.senderUid === (currentUser ? currentUser.uid : null);
        var bubbleClass = isSent ? 'sent' : 'received';
        var roleClass = 'message-role-' + (msg.senderRole || 'client');
        var roleLabel = msg.senderRole ? (msg.senderRole.charAt(0).toUpperCase() + msg.senderRole.slice(1)) : 'Client';
        var bubbleContent = '';
        if (msg.title) {
          bubbleContent += '<div class="update-title">' + escapeHtml(msg.title) + '</div>';
        }
        bubbleContent += '<div>' + escapeHtml(msg.text || '') + '</div>';
        if (msg.photos && msg.photos.length > 0) {
          bubbleContent += '<div class="update-photos-grid">';
          msg.photos.forEach(function(url) {
            bubbleContent += '<img src="' + escapeAttr(url) + '" onclick="document.getElementById(\'photoLightboxOverlay\').style.display=\'flex\';document.getElementById(\'photoLightboxImg\').src=this.src;" loading="lazy">';
          });
          bubbleContent += '</div>';
        }
        if (msg.files && msg.files.length > 0) {
          bubbleContent += '<div class="update-files-list">';
          msg.files.forEach(function(f) {
            bubbleContent += '<a href="' + escapeAttr(f.url) + '" target="_blank">&#128206; ' + escapeHtml(f.name) + '</a>';
          });
          bubbleContent += '</div>';
        }
        if (msg.updateType && msg.updateType !== 'General') {
          bubbleContent += '<div class="update-type-tag">' + escapeHtml(msg.updateType) + '</div>';
        }
        html += '<div class="message-bubble ' + bubbleClass + '">';
        html += '<div class="message-meta">' + escapeHtml(msg.senderName || 'Unknown') + '<span class="message-role-badge ' + roleClass + '">' + roleLabel + '</span></div>';
        html += bubbleContent;
        html += '<div class="message-time">' + formatMessageTime(msg.createdAt) + '</div>';
        html += '</div>';
      });
    }
    html += '</div>'; // .messages-thread

    // Input area
    html += '<div class="messages-input-area">';
    if (viewerRole === 'admin' || viewerRole === 'employee' || viewerRole === 'client') {
      // Rich input: text + photos + file + type + title
      if (viewerRole === 'admin' || viewerRole === 'employee') {
        html += '<div class="update-title-row" id="updateTitleRow"><input type="text" id="updateTitleInput" placeholder="Update title (optional)"></div>';
      }
      html += '<div class="update-input-row">';
      html += '<textarea id="messageInput" placeholder="' + (viewerRole === 'client' ? 'Send a message or photo...' : 'Write a message...') + '" rows="1"></textarea>';
      html += '<button class="update-send-btn" id="sendMessageBtn">Send</button>';
      html += '</div>';
      html += '<div class="update-input-extras">';
      html += '<span class="update-extras-btn-wrap"><button class="update-extras-btn" id="photoPickerBtn">&#128247; Photos</button><input type="file" id="updatePhotosInput" accept="image/*" multiple style="display:none;"></span>';
      if (viewerRole === 'admin' || viewerRole === 'employee') {
        html += '<span class="update-extras-btn-wrap"><button class="update-extras-btn" id="filePickerBtn">&#128206; File</button><input type="file" id="updateFileInput" style="display:none;"></span>';
        html += '<select class="update-type-select" id="updateTypeSelect"><option value="General">Tag: General</option><option value="Progress">Progress</option><option value="Milestone">Milestone</option><option value="Permitting">Permitting</option><option value="Logistics">Logistics</option></select>';
        html += '<button class="update-title-toggle" id="toggleTitleBtn">+ Title</button>';
      }
      html += '</div>';
      html += '<div class="update-selected-files" id="selectedFilesLabel"></div>';
    }
    html += '</div>'; // .messages-input-area
    html += '</div>'; // .messages-container
    html += '</div>'; // .admin-section
    return html;
  }

  function bindUpdatesEvents(projectId, viewerRole) {
    var sendBtn = document.getElementById('sendMessageBtn');
    var textarea = document.getElementById('messageInput');
    if (!sendBtn || !textarea) return;

    // Auto-grow textarea
    textarea.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    // Title toggle (admin/employee only)
    var titleToggle = document.getElementById('toggleTitleBtn');
    var titleRow = document.getElementById('updateTitleRow');
    if (titleToggle && titleRow) {
      titleToggle.addEventListener('click', function() {
        titleRow.classList.toggle('visible');
        titleToggle.textContent = titleRow.classList.contains('visible') ? '− Title' : '+ Title';
      });
    }

    // Photo/file input change feedback
    var photosInput = document.getElementById('updatePhotosInput');
    var fileInput = document.getElementById('updateFileInput');
    var filesLabel = document.getElementById('selectedFilesLabel');

    function updateFilesLabel() {
      if (!filesLabel) return;
      var parts = [];
      if (photosInput && photosInput.files && photosInput.files.length > 0) {
        parts.push(photosInput.files.length + ' photo' + (photosInput.files.length > 1 ? 's' : '') + ' selected');
      }
      if (fileInput && fileInput.files && fileInput.files.length > 0) {
        parts.push(fileInput.files[0].name);
      }
      if (parts.length > 0) {
        filesLabel.textContent = parts.join(' · ');
        filesLabel.classList.add('visible');
      } else {
        filesLabel.textContent = '';
        filesLabel.classList.remove('visible');
      }
    }

    if (photosInput) photosInput.addEventListener('change', updateFilesLabel);
    if (fileInput) fileInput.addEventListener('change', updateFilesLabel);

    // Wire Photos button to trigger the hidden file input
    var photoPickerBtn = document.getElementById('photoPickerBtn');
    if (photoPickerBtn && photosInput) {
      photoPickerBtn.addEventListener('click', function(e) {
        e.preventDefault();
        photosInput.click();
      });
    }

    // Wire File button to trigger the hidden file input
    var filePickerBtn = document.getElementById('filePickerBtn');
    if (filePickerBtn && fileInput) {
      filePickerBtn.addEventListener('click', function(e) {
        e.preventDefault();
        fileInput.click();
      });
    }

    async function doSend() {
      var text = textarea.value;
      if (!text || !text.trim()) return;
      var msgText = text.trim();
      var hasPhotos = photosInput && photosInput.files && photosInput.files.length > 0;
      var hasFile = fileInput && fileInput.files && fileInput.files.length > 0;
      sendBtn.disabled = true;
      textarea.disabled = true;
      if (hasPhotos || hasFile) {
        sendBtn.textContent = 'Uploading...';
      }
      try {
        var typeSelect = document.getElementById('updateTypeSelect');
        var titleInput = document.getElementById('updateTitleInput');
        var msgData = {
          text: msgText,
          photos: hasPhotos ? Array.from(photosInput.files) : [],
          files: hasFile ? Array.from(fileInput.files) : [],
          updateType: typeSelect ? typeSelect.value : 'General',
          title: titleInput ? titleInput.value : ''
        };
        await sendMessage(projectId, msgData);
        textarea.value = '';
        textarea.style.height = '';
        if (photosInput) { photosInput.value = ''; }
        if (fileInput) { fileInput.value = ''; }
        if (typeSelect) typeSelect.value = 'General';
        if (titleInput) titleInput.value = '';
        if (titleRow) titleRow.classList.remove('visible');
        if (titleToggle) titleToggle.textContent = '+ Title';
        if (filesLabel) { filesLabel.textContent = ''; filesLabel.classList.remove('visible'); }

        // Email notification
        var msgProject = allProjects.find(function(p) { return p.id === projectId; });
        if (msgProject) {
          var senderDisplayName = (userProfile && userProfile.name) ? userProfile.name : 'Your Builder';
          if (userProfile.role === 'admin' || userProfile.role === 'employee') {
            var notifyClientEmail = getClientEmailForProject(msgProject);
            if (notifyClientEmail) {
              sendEmailNotification(notifyClientEmail,
                msgProject.name + ' — New Update from ' + senderDisplayName,
                buildEmailHtml(msgProject.name, 'New Update from ' + escapeHtml(senderDisplayName),
                  '<p style="color:#555;font-size:14px;line-height:1.6;">' + escapeHtml(msgText) + '</p>'
                )
              );
            }
          } else if (userProfile.role === 'client') {
            var notifyAdminEmail = getAdminEmail();
            if (notifyAdminEmail) {
              sendEmailNotification(notifyAdminEmail,
                msgProject.name + ' — New Update from ' + senderDisplayName,
                buildEmailHtml(msgProject.name, 'New Update from ' + escapeHtml(senderDisplayName),
                  '<p style="color:#555;font-size:14px;line-height:1.6;">' + escapeHtml(msgText) + '</p>'
                )
              );
            }
          }
        }
        await loadMessages(projectId);
      } catch (err) {
        showToast('Error sending update: ' + err.message);
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
        textarea.disabled = false;
      }
    }

    sendBtn.addEventListener('click', doSend);
    textarea.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });

    // Auto-scroll to bottom
    var thread = document.querySelector('.messages-thread');
    if (thread) thread.scrollTo(0, 999999);
  }

  // ========================================
  // DOCUMENTS OPERATIONS
  // ========================================

  async function loadDocuments(projectId) {
    documentsLoading = true;
    render();
    try {
      var snap = await db.collection('projects').doc(projectId)
        .collection('documents').orderBy('uploadedAt', 'desc').get();
      projectDocuments = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    } catch (err) {
      console.error('Error loading documents:', err);
      projectDocuments = [];
    }
    documentsLoading = false;
    render();
  }

  async function uploadDocument(projectId, file, category) {
    var storageRef = storage.ref().child('projects/' + projectId + '/documents/' + Date.now() + '_' + file.name);
    var snapshot = await storageRef.put(file);
    var url = await snapshot.ref.getDownloadURL();
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var type = 'other';
    if (ext === 'pdf') type = 'pdf';
    else if (['jpg','jpeg','png','gif','webp','svg'].indexOf(ext) >= 0) type = 'image';
    else if (['doc','docx'].indexOf(ext) >= 0) type = 'doc';
    else if (['xls','xlsx'].indexOf(ext) >= 0) type = 'spreadsheet';

    await db.collection('projects').doc(projectId).collection('documents').add({
      filename: file.name,
      url: url,
      type: type,
      category: category || 'Other',
      uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return url;
  }

  async function deleteDocument(projectId, docId) {
    var docRef = await db.collection('projects').doc(projectId).collection('documents').doc(docId).get();
    if (docRef.exists) {
      var data = docRef.data();
      if (data.url) {
        try { await storage.refFromURL(data.url).delete(); } catch(e) { console.warn('Could not delete file from storage:', e); }
      }
      await db.collection('projects').doc(projectId).collection('documents').doc(docId).delete();
    }
  }

  // ========================================
  // SELECTIONS OPERATIONS
  // ========================================

  async function loadSelections(projectId) {
    selectionsLoading = true;
    render();
    try {
      var snap = await db.collection('projects').doc(projectId)
        .collection('selections').orderBy('createdAt', 'desc').get();
      projectSelections = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    } catch (err) {
      console.error('Error loading selections:', err);
      projectSelections = [];
    }
    selectionsLoading = false;
    render();
  }

  async function addSelection(projectId, data) {
    var selData = {
      name: data.name,
      category: data.category || 'Other',
      status: data.status || 'Pending',
      notes: data.notes || '',
      cost: Number(data.cost) || 0,
      imageUrl: data.imageUrl || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('projects').doc(projectId).collection('selections').add(selData);
  }

  async function updateSelection(projectId, selId, data) {
    await db.collection('projects').doc(projectId).collection('selections').doc(selId).update(data);
  }

  async function deleteSelection(projectId, selId) {
    var selDoc = await db.collection('projects').doc(projectId).collection('selections').doc(selId).get();
    if (selDoc.exists) {
      var data = selDoc.data();
      if (data.imageUrl) {
        try { await storage.refFromURL(data.imageUrl).delete(); } catch(e) { console.warn('Could not delete file from storage:', e); }
      }
      await db.collection('projects').doc(projectId).collection('selections').doc(selId).delete();
    }
  }

  async function uploadSelectionImage(projectId, file) {
    file = await convertHeicIfNeeded(file);
    var storageRef = storage.ref().child('projects/' + projectId + '/selections/' + Date.now() + '_' + file.name);
    var snapshot = await storageRef.put(file);
    return await snapshot.ref.getDownloadURL();
  }

  // ========================================
  // CHANGE ORDERS OPERATIONS
  // ========================================

  async function loadChangeOrders(projectId) {
    changeOrdersLoading = true;
    render();
    try {
      var snap = await db.collection('projects').doc(projectId)
        .collection('changeOrders').orderBy('createdAt', 'desc').get();
      currentChangeOrders = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
    } catch (err) {
      console.error('Error loading change orders:', err);
      currentChangeOrders = [];
    }
    changeOrdersLoading = false;
    render();
  }

  async function addChangeOrder(projectId, data) {
    await db.collection('projects').doc(projectId).collection('changeOrders').add({
      title: data.title,
      description: data.description || '',
      costImpact: Number(data.costImpact) || 0,
      status: 'pending',
      requestedBy: data.requestedBy || 'builder',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      respondedAt: null,
      responseNote: ''
    });
  }

  async function updateChangeOrderStatus(projectId, changeOrderId, status, note, signatureData) {
    var updateData = {
      status: status,
      respondedAt: firebase.firestore.FieldValue.serverTimestamp(),
      responseNote: note || ''
    };
    if (status === 'approved' && signatureData) {
      updateData.signature = signatureData;
      updateData.signedBy = (userProfile && userProfile.name) ? userProfile.name : '';
      updateData.signedAt = firebase.firestore.FieldValue.serverTimestamp();
    }
    await db.collection('projects').doc(projectId).collection('changeOrders').doc(changeOrderId).update(updateData);
  }

  async function deleteChangeOrder(projectId, changeOrderId) {
    await db.collection('projects').doc(projectId).collection('changeOrders').doc(changeOrderId).delete();
  }

  function getChangeOrdersSummary() {
    var total = currentChangeOrders.length;
    var approvedImpact = 0;
    currentChangeOrders.forEach(function(co) {
      if (co.status === 'approved') {
        approvedImpact += Number(co.costImpact) || 0;
      }
    });
    return { total: total, approvedImpact: approvedImpact };
  }

  function formatCostImpact(amount) {
    var num = Number(amount) || 0;
    if (num === 0) return '$0.00';
    var abs = Math.abs(num);
    var formatted = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return num < 0 ? '\u2212' + formatted : '+' + formatted;
  }

  function getDocIcon(type) {
    if (type === 'pdf') return '<div class="doc-icon pdf">PDF</div>';
    if (type === 'image') return '<div class="doc-icon img">IMG</div>';
    if (type === 'doc') return '<div class="doc-icon doc">DOC</div>';
    if (type === 'spreadsheet') return '<div class="doc-icon doc">XLS</div>';
    return '<div class="doc-icon">FILE</div>';
  }

  function isPreviewable(type) {
    return type === 'pdf' || type === 'image';
  }

  window.openDocPreview = function(url, filename, type) {
    var overlay = document.getElementById('docPreviewOverlay');
    var content = document.getElementById('docPreviewContent');
    var title = document.getElementById('docPreviewTitle');
    var downloadLink = document.getElementById('docPreviewDownload');
    if (!overlay || !content) return;
    title.textContent = filename;
    downloadLink.href = url;
    if (type === 'image') {
      content.innerHTML = '<img src="' + url + '" alt="' + filename + '" style="max-width:100%;max-height:75vh;border-radius:4px;">';
    } else if (type === 'pdf') {
      content.innerHTML = '<iframe src="' + url + '" style="width:100%;height:75vh;border:none;border-radius:4px;"></iframe>';
    }
    overlay.style.display = 'flex';
  }

  // ========================================
  // BUDGET DATA LAYER
  // ========================================

  // Extract spreadsheet ID from any Google Sheets URL format
  function extractSheetId(url) {
    if (!url) return null;
    const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function getGvizUrl(sheetUrl) {
    const id = extractSheetId(sheetUrl);
    return id ? 'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:json' : null;
  }

  function getSheetsEditUrl(sheetUrl) {
    const id = extractSheetId(sheetUrl);
    return id ? 'https://docs.google.com/spreadsheets/d/' + id + '/edit' : null;
  }

  const DEMO_BUDGET_DATA = [
    {costCode:"Onsite Toilet Rental",budget:1840,actual:226.52,status:""},
    {costCode:"Builders Risk",budget:4025,actual:2200.80,status:"100%"},
    {costCode:"Company Overhead",budget:920,actual:920,status:"100%"},
    {costCode:"Site Excavation",budget:23000,actual:41176.56,status:""},
    {costCode:"Layout House & Shop",budget:1150,actual:1385.75,status:"100%"},
    {costCode:"Driveway & Patio",budget:28750,actual:0,status:""},
    {costCode:"Footing and Foundation",budget:74750,actual:77850,status:"100%"},
    {costCode:"Framing Labor",budget:41400,actual:24391.50,status:""},
    {costCode:"Lumber Package",budget:34500,actual:34322.10,status:""},
    {costCode:"Truss Package",budget:17250,actual:17066,status:"100%"},
    {costCode:"TPO Roof",budget:21275,actual:0,status:""},
    {costCode:"Plumbing",budget:23000,actual:5175,status:""},
    {costCode:"Plumbing Fixtures",budget:8050,actual:0,status:""},
    {costCode:"House Electrical",budget:23000,actual:0,status:""},
    {costCode:"Lighting Fixtures",budget:5750,actual:0,status:""},
    {costCode:"HVAC",budget:20700,actual:0,status:""},
    {costCode:"Venting",budget:1725,actual:0,status:""},
    {costCode:"Insulation",budget:6900,actual:0,status:""},
    {costCode:"Drywall",budget:23000,actual:0,status:""},
    {costCode:"Shower Glass & Mirrors",budget:4600,actual:0,status:""},
    {costCode:"Finish Carpenter",budget:5750,actual:0,status:""},
    {costCode:"Cabinets",budget:36800,actual:0,status:""},
    {costCode:"Countertops",budget:16100,actual:0,status:""},
    {costCode:"Windows and Doors",budget:75900,actual:31690.18,status:""},
    {costCode:"Front Entry Gate",budget:11500,actual:0,status:""},
    {costCode:"House Garage Doors",budget:6900,actual:0,status:""},
    {costCode:"Interior Paint",budget:8050,actual:0,status:""},
    {costCode:"Concrete Floor Grind",budget:11500,actual:8923.50,status:""},
    {costCode:"Tile Material Only",budget:6900,actual:0,status:""},
    {costCode:"Tile Install",budget:13800,actual:0,status:""},
    {costCode:"Appliances",budget:20700,actual:0,status:""},
    {costCode:"Stone Labor",budget:17250,actual:0,status:""},
    {costCode:"Landscape",budget:22738.95,actual:0,status:""},
    {costCode:"Block Work",budget:37950,actual:23000,status:""},
    {costCode:"Stucco",budget:37950,actual:0,status:""},
    {costCode:"Removal",budget:3450,actual:0,status:""},
    {costCode:"Dumpster Rental",budget:3450,actual:0,status:""},
    {costCode:"Supervision",budget:23000,actual:6000,status:""},
    {costCode:"Stone Material",budget:10987.35,actual:0,status:""},
    {costCode:"Soil Testing",budget:500,actual:0,status:""},
    {costCode:"Permit Fee",budget:10738.70,actual:20554.53,status:""},
    {costCode:"Pool",budget:52500,actual:0,status:""}
  ];

  function parseDemoDataToCategories(items) {
    const categoryGroups = [
      { name: 'General Conditions', items: ['Onsite Toilet Rental', 'Builders Risk', 'Company Overhead'] },
      { name: 'Sitework', items: ['Site Excavation', 'Layout House & Shop', 'Driveway & Patio'] },
      { name: 'Foundation', items: ['Footing and Foundation'] },
      { name: 'Framing', items: ['Framing Labor', 'Lumber Package', 'Truss Package'] },
      { name: 'Roofing', items: ['TPO Roof'] },
      { name: 'Plumbing', items: ['Plumbing', 'Plumbing Fixtures'] },
      { name: 'Electrical', items: ['House Electrical', 'Lighting Fixtures'] },
      { name: 'HVAC & Insulation', items: ['HVAC', 'Venting', 'Insulation'] },
      { name: 'Interior Finishes', items: ['Drywall', 'Shower Glass & Mirrors', 'Finish Carpenter', 'Cabinets', 'Countertops'] },
      { name: 'Doors & Windows', items: ['Windows and Doors', 'Front Entry Gate', 'House Garage Doors'] },
      { name: 'Paint & Flooring', items: ['Interior Paint', 'Concrete Floor Grind', 'Tile Material Only', 'Tile Install'] },
      { name: 'Appliances', items: ['Appliances'] },
      { name: 'Exterior', items: ['Stone Labor', 'Stone Material', 'Block Work', 'Stucco', 'Landscape'] },
      { name: 'Site Services', items: ['Removal', 'Dumpster Rental'] },
      { name: 'Project Management', items: ['Supervision', 'Soil Testing', 'Permit Fee'] },
      { name: 'Pool', items: ['Pool'] }
    ];

    const itemMap = {};
    items.forEach(item => { itemMap[item.costCode] = item; });

    const categories = [];
    categoryGroups.forEach(group => {
      const subItems = [];
      let catBudget = 0, catActual = 0;
      let allComplete = true;
      let hasItems = false;

      group.items.forEach(name => {
        const item = itemMap[name];
        if (item) {
          hasItems = true;
          const variance = item.budget - item.actual;
          subItems.push({
            description: item.costCode, vendor: '', budget: item.budget,
            actual: item.actual, variance: variance, status: item.status, notes: ''
          });
          catBudget += item.budget;
          catActual += item.actual;
          if (item.status !== '100%') allComplete = false;
        }
      });

      if (hasItems) {
        categories.push({
          name: group.name, budget: catBudget, actual: catActual,
          variance: catBudget - catActual,
          status: allComplete && subItems.length > 0 ? '100%' : '',
          subItems: subItems, totalBudget: catBudget, totalActual: catActual,
          totalVariance: catBudget - catActual
        });
      }
    });
    return categories;
  }

  function parseGvizResponse(responseText) {
    try {
      const jsonStr = responseText.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '');
      const json = JSON.parse(jsonStr);
      const rows = json.table.rows;
      const categories = [];
      let currentCategory = null;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.c || [];
        const colA = cells[0] && cells[0].v != null ? String(cells[0].v).trim() : '';
        const colB = cells[1] && cells[1].v != null ? String(cells[1].v).trim() : '';
        const colC = cells[2] && cells[2].v != null ? String(cells[2].v).trim() : '';
        const colD = cells[3] && cells[3].v != null ? String(cells[3].v).trim() : '';
        const colE = cells[4] && cells[4].v != null ? Number(cells[4].v) : 0;
        const colF = cells[5] && cells[5].v != null ? Number(cells[5].v) : 0;
        const colG = cells[6] && cells[6].v != null ? Number(cells[6].v) : 0;
        const colH = cells[7] && cells[7].v != null ? String(cells[7].v).trim() : '';
        const colI = cells[8] && cells[8].v != null ? String(cells[8].v).trim() : '';

        if (colA.toUpperCase() === 'TOTALS') continue;
        if (colA === 'COST CODE' || colA === 'Project:' || colA === 'Address:') continue;

        if (colA && !colB) {
          currentCategory = {
            name: colA, budget: colE, actual: colF || 0, variance: 0,
            status: (colH === '1' || colH === '100%' || colH === '100') ? '100%' : '',
            subItems: [], totalBudget: colE, totalActual: colF || 0, totalVariance: 0
          };
          categories.push(currentCategory);
          continue;
        }

        if (colB.toUpperCase() === 'TOTAL' && currentCategory) {
          currentCategory.totalActual = colF;
          currentCategory.actual = colF;
          currentCategory.variance = currentCategory.budget - colF;
          currentCategory.totalVariance = currentCategory.budget - colF;
          continue;
        }

        if (!colA && colB && currentCategory) {
          currentCategory.subItems.push({
            description: colB, vendor: colC, contact: colD,
            budget: colE, actual: colF, variance: colG, status: colH, notes: colI
          });
          continue;
        }
      }

      categories.forEach(cat => {
        if (cat.variance === 0 && cat.budget > 0) {
          if (cat.subItems.length > 0 && cat.totalActual === 0) {
            cat.actual = cat.subItems.reduce((s, i) => s + i.actual, 0);
            cat.totalActual = cat.actual;
          }
          cat.variance = cat.budget - cat.actual;
          cat.totalVariance = cat.budget - cat.actual;
        }
      });

      return categories.length > 0 ? categories : null;
    } catch (e) {
      console.error('Error parsing gviz response:', e);
      return null;
    }
  }

  async function fetchBudgetData() {
    budgetLoading = true;
    budgetFetchError = null;
    budgetExpandedCategories = {};
    render();

    // Resolve the project's Google Sheet URL
    const project = allProjects.find(p => p.id === (userProfile.projectId || adminSelectedProject));
    const gvizUrl = project && project.googleSheetUrl ? getGvizUrl(project.googleSheetUrl) : null;

    try {
      if (!gvizUrl) throw new Error('No Google Sheet URL configured for this project.');
      const response = await fetch(gvizUrl);
      if (!response.ok) throw new Error('Failed to fetch from Google Sheets (HTTP ' + response.status + ').');
      const text = await response.text();
      const parsed = parseGvizResponse(text);
      if (parsed && parsed.length > 0) {
        budgetData = parsed;
        budgetLastSynced = new Date();
        budgetLoading = false;
        budgetFetchError = null;
        render();
        return;
      }
      throw new Error('No budget data found in the spreadsheet. Check that the sheet has data and sharing is set to "Anyone with the link can view".');
    } catch (e) {
      console.warn('Could not fetch from Google Sheets:', e.message);
      budgetFetchError = e.message;
      budgetLoading = false;
      render();
    }
  }

  function getBudgetTotals() {
    if (!budgetData) return { budget: 0, actual: 0, variance: 0, totalItems: 0, completed: 0, overBudget: 0, onTrack: 0 };
    let totalBudget = 0, totalActual = 0;
    let totalItems = 0, completed = 0, overBudget = 0, onTrack = 0;

    budgetData.forEach(cat => {
      totalBudget += cat.budget;
      totalActual += cat.actual;
      totalItems++;
      if (cat.status === '100%') completed++;
      if (cat.actual > cat.budget && cat.actual > 0) overBudget++;
      else if (cat.budget > 0) onTrack++;
    });

    return { budget: totalBudget, actual: totalActual, variance: totalBudget - totalActual,
      totalItems, completed, overBudget, onTrack };
  }

  // ========================================
  // RENDER ENGINE
  // ========================================

  function render() {
    try {
    updateTitle();
    const app = document.getElementById('app');
    // if (appState === 'login') appState = 'setup'; // fixed login bug
    switch (appState) {
      case 'loading':
        app.innerHTML = renderLoading();
        break;
      case 'setup':
        app.innerHTML = renderSetup();
        bindSetupEvents();
        break;
      case 'login':
        app.innerHTML = renderLogin();
        bindLoginEvents();
        break;
      case 'forgot':
        app.innerHTML = renderForgotPassword();
        bindForgotEvents();
        break;
      case 'admin':
        app.innerHTML = renderAdminLayout();
        bindAdminEvents();
        break;
      case 'employee':
        app.innerHTML = renderEmployeeLayout();
        bindEmployeeEvents();
        break;
      case 'client':
        app.innerHTML = renderClientLayout();
        bindClientEvents();
        break;
    }
    } catch (err) {
      console.error('[Render] Uncaught error:', err);
      var app2 = document.getElementById('app');
      if (app2) {
        app2.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;padding:40px;text-align:center;">
            <div style="font-family:var(--font-nav);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--accent);margin-bottom:16px;">Something went wrong</div>
            <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:8px;">The page couldn't load correctly.</div>
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:28px;">This is usually temporary. Refreshing the page will fix it.</div>
            <button onclick="window.location.reload()" style="font-family:var(--font-nav);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;background:var(--text);color:var(--bg);border:none;border-radius:4px;padding:12px 24px;cursor:pointer;">Refresh Page</button>
          </div>
        `;
      }
    }
  }

  // ========================================
  // LOADING VIEW
  // ========================================

  function renderLoading() {
    return `
      <div class="loading-screen">
        <div class="spinner-large"></div>
        <p>Loading portal...</p>
      </div>
    `;
  }

  // ========================================
  // SETUP VIEW (First-Run)
  // ========================================

  function renderSetup() {
    return `
      <div class="setup-page">
        <div class="setup-container">
          <div class="login-brand">${PORTAL_CONFIG.companyName}</div>
          <div class="login-subtitle">${PORTAL_CONFIG.tagline}</div>
          <div class="setup-desc">
            Welcome! No admin account exists yet.<br>
            Create your admin account to get started.
          </div>
          <form class="login-form" id="setupForm">
            <div class="form-group">
              <label for="setupName">Full Name</label>
              <input type="text" id="setupName" class="form-input" placeholder="Your name" required>
            </div>
            <div class="form-group">
              <label for="setupEmail">Email</label>
              <input type="email" id="setupEmail" class="form-input" placeholder="admin@yourcompany.com" autocomplete="email" required>
            </div>
            <div class="form-group">
              <label for="setupPassword">Password</label>
              <input type="password" id="setupPassword" class="form-input" placeholder="Min 6 characters" autocomplete="new-password" required minlength="6">
            </div>
            <div class="login-error" id="setupError"></div>
            <button type="submit" class="login-btn" id="setupBtn">Create Admin Account</button>
          </form>
        </div>
      </div>
    `;
  }

  function bindSetupEvents() {
    document.getElementById('setupForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('setupBtn');
      const errEl = document.getElementById('setupError');
      const name = document.getElementById('setupName').value.trim();
      const email = document.getElementById('setupEmail').value.trim();
      const password = document.getElementById('setupPassword').value;

      btn.disabled = true;
      btn.textContent = 'Creating...';
      errEl.textContent = '';

      try {
        await createAdminAccount(email, password, name);
        // Auth state listener will handle the rest
      } catch (err) {
        errEl.textContent = firebaseErrorMessage(err);
        btn.disabled = false;
        btn.textContent = 'Create Admin Account';
      }
    });
  }

  // ========================================
  // LOGIN VIEW
  // ========================================

  function renderLogin() {
    return `
      <div class="login-page">
        <div class="login-container">
          <div class="login-brand">${PORTAL_CONFIG.companyName}</div>
          <div class="login-subtitle">${PORTAL_CONFIG.tagline}</div>
          <form class="login-form" id="loginForm">
            <div class="form-group">
              <label for="loginEmail">Email</label>
              <input type="email" id="loginEmail" class="form-input" placeholder="you@email.com" autocomplete="email" required>
            </div>
            <div class="form-group">
              <label for="loginPassword">Password</label>
              <input type="password" id="loginPassword" class="form-input" placeholder="••••••••" autocomplete="current-password" required>
            </div>
            <div class="login-error" id="loginError"></div>
            <button type="submit" class="login-btn" id="loginBtn">Sign In</button>
            <button type="button" class="login-forgot" id="forgotBtn">Forgot password?</button>
          </form>
        </div>
      </div>
    `;
  }

  function bindLoginEvents() {
    document.getElementById('loginForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('loginBtn');
      const errEl = document.getElementById('loginError');
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;

      btn.disabled = true;
      btn.textContent = 'Signing in...';
      errEl.textContent = '';

      try {
        await auth.signInWithEmailAndPassword(email, password);
        // Auth state listener handles the rest
      } catch (err) {
        errEl.textContent = firebaseErrorMessage(err);
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });

    document.getElementById('forgotBtn').addEventListener('click', () => {
      appState = 'forgot';
      render();
    });

  }

  // ========================================
  // FORGOT PASSWORD VIEW
  // ========================================

  function renderForgotPassword() {
    return `
      <div class="login-page">
        <div class="login-container">
          <div class="login-brand">${PORTAL_CONFIG.companyName}</div>
          <div class="login-subtitle">Password Reset</div>
          <form class="login-form" id="forgotForm">
            <div class="form-group">
              <label for="forgotEmail">Email</label>
              <input type="email" id="forgotEmail" class="form-input" placeholder="you@email.com" autocomplete="email" required>
            </div>
            <div class="login-error" id="forgotError"></div>
            <div class="login-success" id="forgotSuccess"></div>
            <button type="submit" class="login-btn" id="forgotBtn">Send Reset Link</button>
            <button type="button" class="login-forgot" id="backToLoginBtn">← Back to Sign In</button>
          </form>
        </div>
      </div>
    `;
  }

  function bindForgotEvents() {
    document.getElementById('forgotForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('forgotBtn');
      const errEl = document.getElementById('forgotError');
      const successEl = document.getElementById('forgotSuccess');
      const email = document.getElementById('forgotEmail').value.trim();

      btn.disabled = true;
      btn.textContent = 'Sending...';
      errEl.textContent = '';
      successEl.textContent = '';

      try {
        await auth.sendPasswordResetEmail(email);
        successEl.textContent = 'Reset link sent! Check your email.';
        btn.textContent = 'Sent';
      } catch (err) {
        errEl.textContent = firebaseErrorMessage(err);
        btn.disabled = false;
        btn.textContent = 'Send Reset Link';
      }
    });

    document.getElementById('backToLoginBtn').addEventListener('click', () => {
      appState = 'login';
      render();
    });
  }

  // ========================================
  // CLIENT VIEW
  // ========================================

  function renderClientLayout() {
    const project = allProjects.find(p => p.id === userProfile.projectId);
    return `
      <nav class="nav-bar">
        <div class="nav-logo">${PORTAL_CONFIG.companyName}<span>${PORTAL_CONFIG.tagline}</span></div>
        <div class="nav-links-wrap"><div class="nav-links">
          ${project ? `
            <button class="nav-link ${clientView === 'dashboard' ? 'active' : ''}" data-client-nav="dashboard">Home</button>
            <button class="nav-link ${clientView === 'finances' ? 'active' : ''}" data-client-nav="finances">Finances</button>
            <button class="nav-link ${clientView === 'updates' ? 'active' : ''}" data-client-nav="updates">Updates</button>
            <button class="nav-link ${clientView === 'changeOrders' ? 'active' : ''}" data-client-nav="changeOrders">Approvals</button>
            <button class="nav-link ${clientView === 'selections' ? 'active' : ''}" data-client-nav="selections">Selections</button>
            <button class="nav-link ${clientView === 'documents' ? 'active' : ''}" data-client-nav="documents">Documents</button>
          ` : ''}
          <button class="nav-link" id="logoutBtn">Logout</button>
        </div></div>
      </nav>
      <main class="main-content">
        ${project ? (function() {
          if (clientView === 'finances') return renderClientFinances(project);
          if (clientView === 'photos') return renderClientPhotosTab(project);
          if (clientView === 'documents') return renderClientDocumentsTab(project);
          if (clientView === 'selections') return renderClientSelectionsTab(project);
          if (clientView === 'changeOrders') return renderClientChangeOrders(project);
          if (clientView === 'updates') return renderUpdatesTab(project, 'client');
          return renderClientDashboard(project);
        })() : renderClientNoProject()}
        ${renderClientFooter()}
      </main>
      ${lightboxPhoto ? '<div class="photo-lightbox" id="photoLightbox"><img src="' + escapeAttr(lightboxPhoto.url) + '" alt="' + escapeAttr(lightboxPhoto.caption) + '"><div class="photo-lightbox-caption">' + escapeHtml(lightboxPhoto.caption) + '</div></div>' : ''}
    `;
  }

  function renderClientFooter() {
    const portalDomain = PORTAL_CONFIG.portalUrl.replace(/^https?:\/\//, '');
    const phoneItem = PORTAL_CONFIG.supportPhone
      ? `<div class="client-footer-dot"></div><div class="client-footer-item">${escapeHtml(PORTAL_CONFIG.supportPhone)}</div>`
      : '';
    return `
      <footer class="client-footer">
        <div class="client-footer-item">${escapeHtml(PORTAL_CONFIG.companyName)}</div>
        <div class="client-footer-dot"></div>
        <div class="client-footer-item"><a href="mailto:${escapeAttr(PORTAL_CONFIG.supportEmail)}">${escapeHtml(PORTAL_CONFIG.supportEmail)}</a></div>
        ${phoneItem}
        <div class="client-footer-dot"></div>
        <div class="client-footer-item" style="opacity:0.5;">Project Map — Powered by Dune</div>
      </footer>
    `;
  }

  function renderClientNoProject() {
    return `
      <div class="finances-page-header">
        <div class="finances-page-title">WELCOME</div>
        <div class="finances-page-subtitle">${escapeHtml((userProfile.name || '').split(' ')[0])}</div>
      </div>
      <div class="finances-content-card"><div class="finances-content-card-body">
        <div class="finances-invoices-empty">
          <div class="finances-invoices-empty-icon">PM</div>
          <div class="finances-invoices-empty-title">No Active Projects</div>
          <div class="finances-invoices-empty-msg">Contact your project manager and they'll get you set up here.</div>
        </div>
      </div></div>
    `;
  }

  function renderClientDashboard(project) {
    const cp = getCurrentPhase(project);
    const cpNum = cp ? (project.phases.indexOf(cp) + 1) : 1;
    const cpDef = getPhaseDef(cpNum);
    const firstName = escapeHtml((userProfile.name || '').split(' ')[0]);

    const heroHtml = project.heroImageUrl ? `
      <div class="project-hero" style="background-image:url('${escapeAttr(project.heroImageUrl)}');">
        <div class="project-hero-overlay">
          <div class="project-hero-content">
            <h1 class="project-hero-welcome">Welcome, ${firstName}</h1>
            <p class="project-hero-subtitle">${escapeHtml(project.name)}${project.location ? ' — ' + escapeHtml(project.location) : ''}</p>
          </div>
        </div>
      </div>
    ` : `
      <div class="welcome-header">
        <h1>Welcome, ${firstName}</h1>
        <p>Here's the latest on your project.</p>
      </div>
    `;

    return `
      ${heroHtml}
      ${renderActionNeeded()}
      <div class="dashboard-top-grid">
        ${renderProjectOverview(project, cp, cpNum, cpDef)}
        ${renderDashboardFinances()}
      </div>
      ${renderVisualTimeline(project)}
      ${renderTimeline(project)}
      ${renderDashboardFieldNotes()}
    `;
  }

  // Action Needed banner — shows on Home if there are pending COs or unpaid invoices
  function renderActionNeeded() {
    var pendingCOs = currentChangeOrders.filter(function(co) { return co.status === 'pending'; });
    var unpaidInvoices = currentInvoices.filter(function(inv) { return inv.status !== 'paid' && inv.status !== 'void'; });
    if (pendingCOs.length === 0 && unpaidInvoices.length === 0) return '';
    var items = '';
    if (pendingCOs.length > 0) {
      items += '<button class="action-needed-item" data-client-nav="changeOrders">';
      items += '<span class="action-needed-dot"></span>';
      items += '<span class="action-needed-text">Change order' + (pendingCOs.length > 1 ? 's' : '') + ' pending your approval</span>';
      items += '<span class="action-needed-arrow">→</span>';
      items += '</button>';
    }
    if (unpaidInvoices.length > 0) {
      items += '<button class="action-needed-item" data-client-nav="finances">';
      items += '<span class="action-needed-dot"></span>';
      items += '<span class="action-needed-text">Invoice' + (unpaidInvoices.length > 1 ? 's' : '') + ' ready for payment</span>';
      items += '<span class="action-needed-arrow">→</span>';
      items += '</button>';
    }
    return '<div class="action-needed">' + items + '</div>';
  }

  function renderDashboardFinances() {
    // Budget totals (from pre-loaded firestoreBudgetItems)
    var hasItems = firestoreBudgetItems && firestoreBudgetItems.length > 0;
    var budgetLoaded = hasItems && firestoreBudgetItems[0].cost_code !== undefined; // new schema

    if (!hasItems) return ''; // nothing to show yet

    var totalBudget = 0, totalSpent = 0;
    firestoreBudgetItems.forEach(function(item) {
      // Skip new-schema category headers only (parent_code is explicitly null)
      // Old-schema items have parent_code === undefined and must not be skipped
      if (item.parent_code === null) return;
      totalBudget += budgetAmt(item);
      totalSpent  += actualAmt(item);
    });
    var remaining = totalBudget - totalSpent;
    var pct = totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;

    // Outstanding invoices
    var totalOutstanding = 0;
    (currentInvoices || []).forEach(function(inv) {
      if (inv.status !== 'paid' && inv.status !== 'void') totalOutstanding += Number(inv.amount) || 0;
    });

    var items = '';

    items += '<div class="dash-fin-item">';
    items += '<span class="dash-fin-label">Total Budget</span>';
    items += '<span class="dash-fin-value">' + formatCurrency(totalBudget) + '</span>';
    items += '</div>';

    items += '<div class="dash-fin-item">';
    items += '<span class="dash-fin-label">Spent to Date</span>';
    items += '<span class="dash-fin-value">' + formatCurrency(totalSpent) + '</span>';
    items += '</div>';

    items += '<div class="dash-fin-item">';
    items += '<span class="dash-fin-label">Remaining</span>';
    items += '<span class="dash-fin-value' + (remaining < 0 ? ' dash-fin-owed' : '') + '">' + formatCurrency(remaining) + '</span>';
    items += '</div>';

    if (totalOutstanding > 0) {
      items += '<div class="dash-fin-item">';
      items += '<span class="dash-fin-label">Invoices Due</span>';
      items += '<span class="dash-fin-value dash-fin-owed">' + formatCurrency(totalOutstanding) + '</span>';
      items += '</div>';
    }

    // Progress bar
    var bar = pct > 0
      ? '<div class="dash-fin-bar"><div class="dash-fin-bar-fill" style="width:' + pct.toFixed(1) + '%;' + (pct > 100 ? 'background:#A0705A' : '') + '"></div></div>'
        + '<div class="dash-fin-bar-label">' + pct.toFixed(0) + '% of budget spent</div>'
      : '';

    return '<div class="dash-finances">'
      + '<div class="dash-finances-header">'
      + '<span class="dash-finances-title">Finances</span>'
      + '<button class="dash-finances-link" data-client-nav="finances">View details →</button>'
      + '</div>'
      + '<div class="dash-finances-items">' + items + '</div>'
      + bar
      + '</div>';
  }

  function renderDashboardFieldNotes() {
    if (!currentMessages || currentMessages.length === 0) return '';
    const recent = currentMessages.slice(-1).reverse();
    let itemsHtml = '';
    recent.forEach(function(msg) {
      const senderName = escapeHtml(msg.senderName || 'Team');
      const senderRole = msg.senderRole ? ' <span style="opacity:0.6">(' + escapeHtml(msg.senderRole) + ')</span>' : '';
      const ts = msg.timestamp && msg.timestamp.toDate ? msg.timestamp.toDate() : (msg.timestamp ? new Date(msg.timestamp) : new Date());
      const timeStr = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const photoCount = (msg.photos && msg.photos.length) ? `<div class="dashboard-fn-photos">📷 ${msg.photos.length} photo${msg.photos.length > 1 ? 's' : ''}</div>` : '';
      itemsHtml += `
        <div class="dashboard-fn-item">
          <div class="dashboard-fn-meta">
            <span class="dashboard-fn-sender">${senderName}${senderRole}</span>
            <span class="dashboard-fn-time">${timeStr}</span>
          </div>
          <div class="dashboard-fn-text">${escapeHtml(msg.text || '')}</div>
          ${photoCount}
        </div>
      `;
    });
    return `
      <div class="dashboard-fieldnotes">
        <div class="dashboard-fieldnotes-header">
          <div class="dashboard-fieldnotes-title">Recent Updates</div>
          <button class="dashboard-fieldnotes-viewall" id="viewAllFieldNotesBtn">View all →</button>
        </div>
        ${itemsHtml}
      </div>
    `;
  }

  function renderProjectOverview(project, cp, cpNum, cpDef) {
    return `
      <div class="project-overview">
        <div class="project-overview-header">
          <h2 class="project-name">${escapeHtml(project.name)}${project.location ? ' — ' + escapeHtml(project.location) : ''}</h2>
          <div class="project-phase-badge">Phase ${cpNum}: ${cpDef.name}</div>
        </div>
        <div class="project-meta">
          <div class="project-meta-item">
            <span class="project-meta-label">Start Date</span>
            <span class="project-meta-value">${formatDate(project.startDate)}</span>
          </div>
          <div class="project-meta-item">
            <span class="project-meta-label">Est. Completion</span>
            <span class="project-meta-value">${formatDate(project.estCompletion)}</span>
          </div>
          <div class="project-meta-item">
            <span class="project-meta-label">Progress</span>
            <span class="project-meta-value">${getProjectProgress(project)}%</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderMiniTimeline(project) {
    if (!project.phases) return '';
    let html = '<div class="mini-timeline">';
    project.phases.forEach((phase, i) => {
      const def = getPhaseDef(i + 1);
      html += `<div class="mini-timeline-step ${phase.status}">`;
      html += `<div class="mini-timeline-dot" title="${def.name}"></div>`;
      html += `<span class="mini-timeline-label">${def.name}</span>`;
      html += '</div>';
      if (i < project.phases.length - 1) {
        html += `<div class="mini-timeline-line" style="background:${phase.status === 'completed' ? 'var(--success)' : 'var(--border-light)'}"></div>`;
      }
    });
    html += '</div>';
    return html;
  }

  function renderTimeline(project) {
    if (!project.phases) return '';
    const completedCount = project.phases.filter(p => p.status === 'completed').length;
    const inProgress = project.phases.find(p => p.status === 'in-progress');
    const progressFraction = (completedCount + (inProgress ? 0.5 : 0)) / project.phases.length;

    let timelineHtml = `
      <div class="section-header">
        <h2 class="section-title">Project Timeline</h2>
        <span class="section-subtitle">${completedCount} of ${project.phases.length} phases complete</span>
      </div>
      <div class="timeline">
        <div class="timeline-track"></div>
        <div class="timeline-progress" style="height: ${progressFraction * 100}%"></div>
    `;

    project.phases.forEach((phase, i) => {
      const def = getPhaseDef(i + 1);
      const statusLabel = phase.status === 'in-progress' ? 'In Progress' : phase.status === 'completed' ? 'Complete' : 'Upcoming';
      const statusBadgeClass = phase.status === 'in-progress' ? 'status-in-progress' : phase.status === 'completed' ? 'status-completed' : 'status-upcoming';

      timelineHtml += `
        <div class="timeline-item ${phase.status}">
          <div class="timeline-dot"></div>
          <div class="timeline-item-content">
            <div class="timeline-phase-header">
              <div style="display:flex;align-items:center;flex:1;min-width:0">
                <span class="timeline-phase-number">${String(i + 1).padStart(2, '0')}</span>
                <span class="timeline-phase-name">${escapeHtml(phase.name || def.name)}</span>
              </div>
              <span class="timeline-phase-status ${statusBadgeClass}">${statusLabel}</span>
            </div>
            <div class="timeline-phase-dates">${formatDate(phase.startDate)} — ${formatDate(phase.endDate)}</div>
            <div class="timeline-phase-desc">${escapeHtml(phase.description || def.desc)}</div>
          </div>
        </div>
      `;
    });

    timelineHtml += '</div>';

    const calHtml = renderPhaseCalendar(project.phases, 'clientTimeline');

    return '<div class="phases-layout"><div>' + timelineHtml + '</div>' + calHtml + '</div>';
  }

  // ========================================
  // FINANCES TAB (Budget summary + Invoices)
  // ========================================
  // Build invoice list HTML — used inside the new card layout
  function buildInvoiceListHtml() {
    var out = '';
    (currentInvoices || []).forEach(function(inv) {
      var isPaid = inv.status === 'paid';
      out += '<div class="invoice-item' + (isPaid ? ' is-paid' : '') + '">';
      out += '<div class="invoice-item-header"><div class="invoice-item-title">' + escapeHtml(inv.title || '') + '</div>';
      out += '<div style="display:flex;align-items:center;gap:8px;"><div class="invoice-amount">' + formatCurrency(inv.amount) + '</div>';
      out += renderInvoiceStatusBadge(inv.status) + '</div></div>';
      out += '<div class="invoice-item-meta">';
      if (inv.dueDate) out += '<span style="font-family:var(--font-nav);font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-tertiary)">Due: ' + formatDate(inv.dueDate) + '</span>';
      out += '</div>';
      if (inv.notes) out += '<div class="invoice-item-notes">' + escapeHtml(inv.notes) + '</div>';
      if (inv.invoiceUrl) {
        out += '<div class="invoice-item-footer">';
        out += !isPaid
          ? '<a href="' + escapeAttr(inv.invoiceUrl) + '" target="_blank" rel="noopener noreferrer" class="invoice-pay-btn">Pay Now</a>'
          : '<a href="' + escapeAttr(inv.invoiceUrl) + '" target="_blank" rel="noopener noreferrer" class="invoice-view-btn">View Invoice</a>';
        out += '</div>';
      }
      out += '</div>';
    });
    return out;
  }

  function renderClientFinances(project) {
    var hasSheet = project && project.googleSheetUrl && extractSheetId(project.googleSheetUrl);

    // ── COMPUTE TOTALS ──────────────────────────────────────────────
    var totals = { budget: 0, actual: 0 };
    if (hasSheet && budgetData) {
      budgetData.forEach(function(cat) {
        totals.budget += cat.budget || 0;
        totals.actual += cat.actual || 0;
      });
    } else if (!hasSheet && firestoreBudgetItems && firestoreBudgetItems.length > 0) {
      var isNew = firestoreBudgetItems[0].cost_code !== undefined;
      var t = isNew ? getTemplatedBudgetTotals() : getFirestoreBudgetTotals();
      totals.budget = t.budget;
      totals.actual = t.actual;
    }
    var remaining = totals.budget - totals.actual;
    var pctSpent = totals.budget > 0 ? Math.min(100, (totals.actual / totals.budget) * 100) : 0;
    var isOver = remaining < 0;

    // Budget data availability flags
    var budgetLoaded = (hasSheet && budgetData && !budgetLoading && !budgetFetchError) ||
                       (!hasSheet && !firestoreBudgetLoading && firestoreBudgetItems.length > 0);
    var budgetIsLoading = (hasSheet && (budgetLoading || !budgetData)) || (!hasSheet && firestoreBudgetLoading);

    // ── PAGE TITLE ────────────────────────────────────────────────────
    var html = '<div class="finances-page-header">';
    html += '<div class="finances-page-title">FINANCES</div>';
    html += '<div class="finances-page-subtitle">' + escapeHtml(project ? project.name : '') + '</div>';
    html += '</div>';

    // ── FINANCIAL OVERVIEW CARD ───────────────────────────────────────
    html += '<div class="finances-overview-card">';
    html += '<div class="finances-overview-eyebrow">Financial Overview</div>';

    if (budgetIsLoading) {
      html += '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading\u2026</span></div>';
    } else if (hasSheet && budgetFetchError) {
      html += '<div class="budget-fetch-error"><p class="budget-fetch-error-msg">&#9888; Could not load budget: ' + escapeHtml(budgetFetchError) + '</p>';
      html += '<button class="btn btn-secondary btn-small" id="budgetRefreshBtn" style="margin-top:12px">Retry</button></div>';
    } else if (!budgetLoaded) {
      html += '<div class="finances-empty-budget"><p style="font-size:13px;color:var(--text-tertiary);margin:0;line-height:1.6;">Your builder will add budget details here as the project progresses.</p></div>';
    } else {
      html += '<div class="finances-kpi-row">';
      html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Total Budget</div><div class="finances-kpi-value">' + formatCurrency(totals.budget) + '</div></div>';
      html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Total Spent</div><div class="finances-kpi-value">' + formatCurrency(totals.actual) + '</div></div>';
      html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Remaining</div><div class="finances-kpi-value ' + (remaining < 0 ? 'negative' : (remaining > 0 ? 'positive' : '')) + '">' + formatCurrency(Math.abs(remaining)) + '</div></div>';
      html += '<div class="finances-kpi-item"><div class="finances-kpi-label">% Spent</div><div class="finances-kpi-value ' + (pctSpent >= 100 ? 'negative' : '') + '">' + pctSpent.toFixed(1) + '%</div></div>';
      html += '</div>';
      html += '<div class="finances-progress-track"><div class="finances-progress-fill" style="width:' + Math.min(100, pctSpent).toFixed(1) + '%;' + (pctSpent >= 100 ? 'background:#924014;' : '') + '"></div></div>';
      if (hasSheet && budgetLastSynced) {
        var syncTime = budgetLastSynced.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
          ' at ' + budgetLastSynced.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        html += '<div class="finances-sync-row">';
        html += '<span class="finances-sync-label">Last synced ' + escapeHtml(syncTime) + '</span>';
        html += '<button class="budget-refresh-btn" id="budgetRefreshBtn"><span class="spinner"></span>Refresh</button>';
        html += '</div>';
      }
    }
    html += '</div>'; // .finances-overview-card

    // ── INVOICES CARD ─────────────────────────────────────────────────
    html += '<div class="finances-content-card">';
    html += '<div class="finances-content-card-header">';
    html += '<div class="finances-content-card-title">Invoices</div>';
    html += '</div>';
    html += '<div class="finances-content-card-body">';
    if (invoicesLoading) {
      html += '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading invoices\u2026</span></div>';
    } else if (!currentInvoices || currentInvoices.length === 0) {
      html += '<div class="finances-invoices-empty">';
      html += '<div class="finances-invoices-empty-icon">PM</div>';
      html += '<div class="finances-invoices-empty-title">No invoices yet</div>';
      html += '<div class="finances-invoices-empty-msg">Invoices will appear here as your project progresses. Your builder will notify you when payment is due.</div>';
      html += '</div>';
    } else {
      html += renderInvoicesSummaryBar();
      html += buildInvoiceListHtml();
    }
    html += '</div>'; // .finances-content-card-body
    html += '</div>'; // .finances-content-card (invoices)

    // ── BUDGET BREAKDOWN CARD ─────────────────────────────────────────
    if (budgetLoaded) {
      html += '<div class="finances-content-card">';
      html += '<div class="finances-content-card-header finances-content-card-header--warm">';
      html += '<div class="finances-content-card-title">Budget Breakdown</div>';
      html += '<div class="finances-content-card-desc">Tap any category to expand line items.</div>';
      html += '</div>';
      html += '<div class="finances-content-card-body--table">';
      html += '<div class="budget-table-wrapper"><table class="budget-table"><thead><tr>';
      html += '<th>Cost Code</th><th>Budget</th><th>Actual</th><th>Variance</th><th>Status</th>';
      html += '</tr></thead><tbody>';

      if (hasSheet) {
        var grandBudgetS = 0, grandActualS = 0, grandVarianceS = 0;
        budgetData.forEach(function(cat, catIndex) {
          var isOpen = budgetExpandedCategories[catIndex] === true;
          var catVarClass = cat.variance < 0 ? 'variance-over' : 'variance-under';
          var catBadge = cat.status === '100%'
            ? '<span class="budget-status-badge budget-status-complete">Complete</span>'
            : (cat.actual > 0 ? '<span class="budget-status-badge budget-status-in-progress">In Progress</span>' : '');
          html += '<tr class="budget-row-category" data-budget-cat="' + catIndex + '">';
          html += '<td><span class="budget-category-toggle ' + (isOpen ? 'open' : '') + '">&#9654;</span>' + escapeHtml(cat.name) + '</td>';
          html += '<td>' + formatCurrency(cat.budget) + '</td><td>' + formatCurrency(cat.actual) + '</td>';
          html += '<td class="' + catVarClass + '">' + formatCurrency(cat.variance) + '</td><td>' + catBadge + '</td></tr>';
          cat.subItems.forEach(function(item) {
            var ivClass = item.variance < 0 ? 'variance-over' : 'variance-under';
            var iBadge = (item.status === '100%' || item.status === '100' || item.status === '1') ? '<span class="budget-status-badge budget-status-complete">Complete</span>' : '';
            html += '<tr class="budget-row-sub ' + (isOpen ? 'expanded' : '') + '" data-budget-cat-child="' + catIndex + '">';
            html += '<td>' + escapeHtml(item.description) + (item.vendor ? '<br><span style="color:var(--text-tertiary);font-size:11px">' + escapeHtml(item.vendor) + '</span>' : '') + '</td>';
            html += '<td>' + formatCurrency(item.budget) + '</td><td>' + formatCurrency(item.actual) + '</td>';
            html += '<td class="' + ivClass + '">' + formatCurrency(item.variance) + '</td><td>' + iBadge + '</td></tr>';
          });
          var tvClass = cat.totalVariance < 0 ? 'variance-over' : 'variance-under';
          html += '<tr class="budget-row-total ' + (isOpen ? 'expanded' : '') + '" data-budget-cat-child="' + catIndex + '">';
          html += '<td style="padding-left:40px;font-weight:600;">TOTAL</td>';
          html += '<td>' + formatCurrency(cat.totalBudget) + '</td><td>' + formatCurrency(cat.totalActual) + '</td>';
          html += '<td class="' + tvClass + '">' + formatCurrency(cat.totalVariance) + '</td><td></td></tr>';
          grandBudgetS += cat.budget || 0; grandActualS += cat.actual || 0; grandVarianceS += cat.variance || 0;
        });
        var gvClassS = grandVarianceS < 0 ? 'variance-over' : 'variance-under';
        html += '<tr class="budget-row-grand"><td>TOTALS</td>';
        html += '<td>' + formatCurrency(grandBudgetS) + '</td><td>' + formatCurrency(grandActualS) + '</td>';
        html += '<td class="' + gvClassS + '">' + formatCurrency(grandVarianceS) + '</td><td></td></tr>';
      } else {
        var isNew2 = firestoreBudgetItems[0].cost_code !== undefined;
        var grandBudgetF = 0, grandActualF = 0;
        var grouped2 = {};
        firestoreBudgetItems.forEach(function(it) {
          if (isNew2 && !it.parent_code) return;
          var cat = itemCatName(it) || 'Other';
          if (!grouped2[cat]) grouped2[cat] = [];
          grouped2[cat].push(it);
        });
        Object.keys(grouped2).forEach(function(catName, catIndex) {
          var items = grouped2[catName];
          var catBudget = 0, catActual = 0;
          items.forEach(function(it) { catBudget += budgetAmt(it); catActual += actualAmt(it); });
          var catVariance = catBudget - catActual;
          var catVarClass = catVariance < 0 ? 'variance-over' : 'variance-under';
          var allComplete = items.every(function(it) { return it.status === 'complete'; });
          var catBadge = allComplete && items.length > 0
            ? '<span class="budget-status-badge budget-status-complete">Complete</span>'
            : (catActual > 0 ? '<span class="budget-status-badge budget-status-in-progress">In Progress</span>' : '');
          var isOp = budgetExpandedCategories[catIndex] === true;
          html += '<tr class="budget-row-category" data-budget-cat="' + catIndex + '">';
          html += '<td><span class="budget-category-toggle ' + (isOp ? 'open' : '') + '">&#9654;</span>' + escapeHtml(catName) + '</td>';
          html += '<td>' + formatCurrency(catBudget) + '</td><td>' + formatCurrency(catActual) + '</td>';
          html += '<td class="' + catVarClass + '">' + formatCurrency(catVariance) + '</td><td>' + catBadge + '</td></tr>';
          items.forEach(function(item) {
            var b = budgetAmt(item), a = actualAmt(item), v = b - a;
            var vClass = v < 0 ? 'variance-over' : 'variance-under';
            var iBadge = item.status === 'complete' ? '<span class="budget-status-badge budget-status-complete">Complete</span>' : '';
            html += '<tr class="budget-row-sub ' + (isOp ? 'expanded' : '') + '" data-budget-cat-child="' + catIndex + '">';
            html += '<td>' + escapeHtml(itemCode(item)) + (item.vendor ? '<br><span style="color:var(--text-tertiary);font-size:11px">' + escapeHtml(item.vendor) + '</span>' : '') + '</td>';
            html += '<td>' + formatCurrency(b) + '</td><td>' + formatCurrency(a) + '</td>';
            html += '<td class="' + vClass + '">' + formatCurrency(v) + '</td><td>' + iBadge + '</td></tr>';
          });
          var tvClass = catVariance < 0 ? 'variance-over' : 'variance-under';
          html += '<tr class="budget-row-total ' + (isOp ? 'expanded' : '') + '" data-budget-cat-child="' + catIndex + '">';
          html += '<td style="padding-left:40px;font-weight:600;">TOTAL</td>';
          html += '<td>' + formatCurrency(catBudget) + '</td><td>' + formatCurrency(catActual) + '</td>';
          html += '<td class="' + tvClass + '">' + formatCurrency(catVariance) + '</td><td></td></tr>';
          grandBudgetF += catBudget; grandActualF += catActual;
        });
        var grandVarianceF = grandBudgetF - grandActualF;
        var gvClassF = grandVarianceF < 0 ? 'variance-over' : 'variance-under';
        html += '<tr class="budget-row-grand"><td>TOTALS</td>';
        html += '<td>' + formatCurrency(grandBudgetF) + '</td><td>' + formatCurrency(grandActualF) + '</td>';
        html += '<td class="' + gvClassF + '">' + formatCurrency(grandVarianceF) + '</td><td></td></tr>';
      }

      html += '</tbody></table></div>';
      html += '</div>'; // .finances-content-card-body--table
      html += '</div>'; // .finances-content-card (breakdown)
    }

    return html;
  }

  function renderClientBudget(project) {
    const hasSheet = project && project.googleSheetUrl && extractSheetId(project.googleSheetUrl);

    // ── GOOGLE SHEETS MODE ──────────────────────────────────────
    if (hasSheet) {
      const syncTime = budgetLastSynced
        ? budgetLastSynced.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
          budgetLastSynced.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        : null;

      let sheetHtml = `
        <div class="budget-page-header"><h2 class="budget-page-title">Budget</h2><p class="budget-page-subtitle">${escapeHtml(project.name)}</p></div>
      `;

      if (budgetLoading) {
        sheetHtml += '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Fetching from Google Sheets...</span></div>';
        return sheetHtml;
      }

      if (budgetFetchError) {
        sheetHtml += '<div class="budget-fetch-error">';
        sheetHtml += '<p class="budget-fetch-error-msg">&#9888; Could not load budget data: ' + escapeHtml(budgetFetchError) + '</p>';
        sheetHtml += '<button class="btn btn-secondary btn-small" id="budgetRefreshBtn" style="margin-top:12px">Retry</button>';
        sheetHtml += '</div>';
        return sheetHtml;
      }

      if (!budgetData) {
        sheetHtml += '<div class="budget-loading"><span class="budget-loading-text">Loading budget data...</span></div>';
        return sheetHtml;
      }

      if (syncTime) {
        sheetHtml += '<div class="budget-sync-row">';
        sheetHtml += '<span class="budget-sync-info">Last synced: ' + escapeHtml(syncTime) + '</span>';
        sheetHtml += '<button class="budget-refresh-btn" id="budgetRefreshBtn"><span class="spinner"></span>Refresh</button>';
        sheetHtml += '</div>';
      }

      sheetHtml += renderBudgetSummary(false);
      // Build read-only collapsible table from budgetData
      sheetHtml += '<div class="budget-table-wrapper"><table class="budget-table"><thead><tr>';
      sheetHtml += '<th>Cost Code</th><th>Budget</th><th>Actual</th><th>Variance</th><th>Status</th>';
      sheetHtml += '</tr></thead><tbody>';
      let grandBudget = 0, grandActual = 0, grandVariance = 0;
      budgetData.forEach(function(cat, catIndex) {
        const isOpen = budgetExpandedCategories[catIndex] === true;
        const catVarianceClass = cat.variance < 0 ? 'variance-over' : 'variance-under';
        const catStatusBadge = cat.status === '100%'
          ? '<span class="budget-status-badge budget-status-complete">Complete</span>'
          : (cat.actual > 0 ? '<span class="budget-status-badge budget-status-in-progress">In Progress</span>' : '');
        sheetHtml += '<tr class="budget-row-category" data-budget-cat="' + catIndex + '">';
        sheetHtml += '<td><span class="budget-category-toggle ' + (isOpen ? 'open' : '') + '">&#9654;</span>' + escapeHtml(cat.name) + '</td>';
        sheetHtml += '<td>' + formatCurrency(cat.budget) + '</td><td>' + formatCurrency(cat.actual) + '</td><td class="' + catVarianceClass + '">' + formatCurrency(cat.variance) + '</td><td>' + catStatusBadge + '</td></tr>';
        cat.subItems.forEach(function(item) {
          const ivClass = item.variance < 0 ? 'variance-over' : 'variance-under';
          const isBadge = (item.status === '100%' || item.status === '100' || item.status === '1') ? '<span class="budget-status-badge budget-status-complete">Complete</span>' : '';
          sheetHtml += '<tr class="budget-row-sub ' + (isOpen ? 'expanded' : '') + '" data-budget-cat-child="' + catIndex + '">';
          sheetHtml += '<td>' + escapeHtml(item.description) + (item.vendor ? '<br><span style="color:var(--text-tertiary);font-size:11px">' + escapeHtml(item.vendor) + '</span>' : '') + '</td>';
          sheetHtml += '<td>' + formatCurrency(item.budget) + '</td><td>' + formatCurrency(item.actual) + '</td><td class="' + ivClass + '">' + formatCurrency(item.variance) + '</td><td>' + isBadge + '</td></tr>';
        });
        const tvClass = cat.totalVariance < 0 ? 'variance-over' : 'variance-under';
        sheetHtml += '<tr class="budget-row-total ' + (isOpen ? 'expanded' : '') + '" data-budget-cat-child="' + catIndex + '">';
        sheetHtml += '<td style="padding-left:40px;font-weight:600;">TOTAL</td><td>' + formatCurrency(cat.totalBudget) + '</td><td>' + formatCurrency(cat.totalActual) + '</td><td class="' + tvClass + '">' + formatCurrency(cat.totalVariance) + '</td><td></td></tr>';
        grandBudget += cat.budget; grandActual += cat.actual; grandVariance += cat.variance;
      });
      const gvClass = grandVariance < 0 ? 'variance-over' : 'variance-under';
      sheetHtml += '<tr class="budget-row-grand"><td>TOTALS</td><td>' + formatCurrency(grandBudget) + '</td><td>' + formatCurrency(grandActual) + '</td><td class="' + gvClass + '">' + formatCurrency(grandVariance) + '</td><td></td></tr>';
      sheetHtml += '</tbody></table></div>';
      return sheetHtml;
    }

    // ── PORTAL EDITOR MODE (Firestore) ────────────────────────────
    if (firestoreBudgetLoading) {
      return `
        <div class="budget-page-header"><h2 class="budget-page-title">Budget</h2><p class="budget-page-subtitle">${escapeHtml(project.name)}</p></div>
        <div class="budget-loading">
          <div class="spinner-large"></div>
          <span class="budget-loading-text">Loading budget data...</span>
        </div>
      `;
    }

    if (firestoreBudgetItems.length === 0) {
      return `
        <div class="budget-page-header"><h2 class="budget-page-title">Budget</h2><p class="budget-page-subtitle">${escapeHtml(project.name)}</p></div>
        <div class="empty-state">
          <div class="empty-state-icon">PM</div>
          <div class="empty-state-title">Budget Coming Soon</div>
          <div class="empty-state-message">Your builder will add budget details here as the project progresses.</div>
        </div>
      `;
    }

    const totals = getFirestoreBudgetTotals();
    const pctSpent = totals.budget > 0 ? Math.min(100, (totals.actual / totals.budget) * 100) : 0;
    const grouped = groupBudgetItemsByCategory();

    let html = `
      <div class="budget-page-header"><h2 class="budget-page-title">Budget</h2><p class="budget-page-subtitle">${escapeHtml(project.name)}</p></div>
      <div class="budget-summary">
        <div class="budget-summary-main">
          <div class="budget-summary-amounts">
            <div class="budget-amount-block">
              <span class="budget-amount-label">Total Budget</span>
              <span class="budget-amount-value">${formatCurrency(totals.budget)}</span>
            </div>
            <div class="budget-amount-block">
              <span class="budget-amount-label">Total Spent</span>
              <span class="budget-amount-value spent">${formatCurrency(totals.actual)}</span>
            </div>
            <div class="budget-amount-block">
              <span class="budget-amount-label">Remaining</span>
              <span class="budget-amount-value remaining" ${totals.variance < 0 ? 'style="color:#A0705A"' : ''}>${formatCurrency(totals.variance)}</span>
            </div>
          </div>
          <div class="budget-progress-bar">
            <div class="budget-progress-fill" style="width: ${pctSpent.toFixed(1)}%;${pctSpent > 100 ? 'background:#A0705A' : ''}"></div>
          </div>
          <div class="budget-progress-label">${pctSpent.toFixed(1)}% of budget spent</div>
        </div>
      </div>
    `;

    // Collapsible table from Firestore data
    html += '<div class="budget-table-wrapper"><table class="budget-table"><thead><tr>';
    html += '<th>Cost Code</th><th>Budget</th><th>Actual</th><th>Variance</th><th>Status</th>';
    html += '</tr></thead><tbody>';

    let grandBudget = 0, grandActual = 0;
    const categoryNames = Object.keys(grouped);
    categoryNames.forEach((catName, catIndex) => {
      const items = grouped[catName];
      let catBudget = 0, catActual = 0;
      items.forEach(it => { catBudget += Number(it.budgetAmount) || 0; catActual += Number(it.actualAmount) || 0; });
      const catVariance = catBudget - catActual;
      const catVarianceClass = catVariance < 0 ? 'variance-over' : 'variance-under';
      const allComplete = items.every(it => it.status === 'complete');
      const catStatusBadge = allComplete && items.length > 0
        ? '<span class="budget-status-badge budget-status-complete">Complete</span>'
        : (catActual > 0 ? '<span class="budget-status-badge budget-status-in-progress">In Progress</span>' : '');

      const isOpen = budgetExpandedCategories[catIndex] === true;

      html += '<tr class="budget-row-category" data-budget-cat="' + catIndex + '">';
      html += '<td><span class="budget-category-toggle ' + (isOpen ? 'open' : '') + '">&#9654;</span>' + escapeHtml(catName) + '</td>';
      html += '<td>' + formatCurrency(catBudget) + '</td>';
      html += '<td>' + formatCurrency(catActual) + '</td>';
      html += '<td class="' + catVarianceClass + '">' + formatCurrency(catVariance) + '</td>';
      html += '<td>' + catStatusBadge + '</td></tr>';

      items.forEach(item => {
        const budget = Number(item.budgetAmount) || 0;
        const actual = Number(item.actualAmount) || 0;
        const variance = budget - actual;
        const varianceClass = variance < 0 ? 'variance-over' : 'variance-under';
        const itemStatusBadge = item.status === 'complete'
          ? '<span class="budget-status-badge budget-status-complete">Complete</span>' : '';

        html += '<tr class="budget-row-sub ' + (isOpen ? 'expanded' : '') + '" data-budget-cat-child="' + catIndex + '">';
        html += '<td>' + escapeHtml(item.costCode) + (item.vendor ? '<br><span style="color:var(--text-tertiary);font-size:11px">' + escapeHtml(item.vendor) + '</span>' : '') + '</td>';
        html += '<td>' + formatCurrency(budget) + '</td>';
        html += '<td>' + formatCurrency(actual) + '</td>';
        html += '<td class="' + varianceClass + '">' + formatCurrency(variance) + '</td>';
        html += '<td>' + itemStatusBadge + '</td></tr>';
      });

      // Category total row
      const totalVarianceClass = catVariance < 0 ? 'variance-over' : 'variance-under';
      html += '<tr class="budget-row-total ' + (isOpen ? 'expanded' : '') + '" data-budget-cat-child="' + catIndex + '">';
      html += '<td style="padding-left:40px;font-weight:600;">TOTAL</td>';
      html += '<td>' + formatCurrency(catBudget) + '</td>';
      html += '<td>' + formatCurrency(catActual) + '</td>';
      html += '<td class="' + totalVarianceClass + '">' + formatCurrency(catVariance) + '</td>';
      html += '<td></td></tr>';

      grandBudget += catBudget;
      grandActual += catActual;
    });

    const grandVariance = grandBudget - grandActual;
    const grandVarianceClass = grandVariance < 0 ? 'variance-over' : 'variance-under';
    html += '<tr class="budget-row-grand"><td>TOTALS</td>';
    html += '<td>' + formatCurrency(grandBudget) + '</td>';
    html += '<td>' + formatCurrency(grandActual) + '</td>';
    html += '<td class="' + grandVarianceClass + '">' + formatCurrency(grandVariance) + '</td>';
    html += '<td></td></tr>';

    html += '</tbody></table></div>';

    return html;
  }

  function renderBudgetSummary(showProject) {
    const totals = getBudgetTotals();
    const pctSpent = totals.budget > 0 ? Math.min(100, (totals.actual / totals.budget) * 100) : 0;

    return `
      <div class="budget-summary">
        <div class="budget-summary-main">
          ${showProject ? '<div class="budget-summary-project">Project Budget Overview</div>' : ''}
          <div class="budget-summary-amounts">
            <div class="budget-amount-block">
              <span class="budget-amount-label">Total Budget</span>
              <span class="budget-amount-value">${formatCurrency(totals.budget)}</span>
            </div>
            <div class="budget-amount-block">
              <span class="budget-amount-label">Total Spent</span>
              <span class="budget-amount-value spent">${formatCurrency(totals.actual)}</span>
            </div>
            <div class="budget-amount-block">
              <span class="budget-amount-label">Remaining</span>
              <span class="budget-amount-value remaining">${formatCurrency(totals.variance)}</span>
            </div>
          </div>
          <div class="budget-progress-bar">
            <div class="budget-progress-fill" style="width: ${pctSpent.toFixed(1)}%"></div>
          </div>
          <div class="budget-progress-label">${pctSpent.toFixed(1)}% of budget spent</div>
        </div>
      </div>
    `;
  }

  function renderBudgetTable(showEditLink) {
    if (budgetLoading) {
      return `<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading budget data...</span></div>`;
    }
    if (!budgetData) {
      return `<div class="budget-loading"><span class="budget-loading-text">No budget data available.</span></div>`;
    }

    const syncTime = budgetLastSynced ? budgetLastSynced.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
    const syncDate = budgetLastSynced ? budgetLastSynced.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

    let html = `
      <div class="budget-toolbar">
        <span class="budget-sync-info">Last synced: ${syncDate} ${syncTime}</span>
        <div style="display:flex;align-items:center;gap:12px;">
          ${(function() {
            const proj = allProjects.find(pr => pr.id === (userProfile.projectId || adminSelectedProject));
            const editUrl = proj && proj.googleSheetUrl ? getSheetsEditUrl(proj.googleSheetUrl) : null;
            return showEditLink && editUrl ? '<a href="' + editUrl + '" target="_blank" class="budget-edit-link">→ Edit in Google Sheets</a>' : '';
          })()}
          <button class="budget-refresh-btn" id="budgetRefreshBtn">
            <span class="spinner"></span>
            Refresh
          </button>
          <button class="btn btn-secondary btn-small" id="downloadBudgetPdfBtn" style="font-size:10px;padding:5px 12px">↓ PDF</button>
        </div>
      </div>
      <div class="budget-table-wrapper">
        <table class="budget-table">
          <thead>
            <tr>
              <th>Cost Code</th>
              <th>Budget</th>
              <th>Actual</th>
              <th>Variance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
    `;

    let grandBudget = 0, grandActual = 0, grandVariance = 0;

    budgetData.forEach((cat, catIndex) => {
      const isOpen = budgetExpandedCategories[catIndex] === true;
      const catVarianceClass = cat.variance < 0 ? 'variance-over' : 'variance-under';
      const catStatusBadge = cat.status === '100%'
        ? '<span class="budget-status-badge budget-status-complete">Complete</span>'
        : (cat.actual > 0 ? '<span class="budget-status-badge budget-status-in-progress">In Progress</span>' : '');

      html += `
        <tr class="budget-row-category" data-budget-cat="${catIndex}">
          <td><span class="budget-category-toggle ${isOpen ? 'open' : ''}">&#9654;</span>${escapeHtml(cat.name)}</td>
          <td>${formatCurrency(cat.budget)}</td>
          <td>${formatCurrency(cat.actual)}</td>
          <td class="${catVarianceClass}">${formatCurrency(cat.variance)}</td>
          <td>${catStatusBadge}</td>
        </tr>
      `;

      cat.subItems.forEach(item => {
        const itemVarianceClass = item.variance < 0 ? 'variance-over' : 'variance-under';
        const itemStatusBadge = (item.status === '100%' || item.status === '100' || item.status === '1')
          ? '<span class="budget-status-badge budget-status-complete">Complete</span>' : '';
        html += `
          <tr class="budget-row-sub ${isOpen ? 'expanded' : ''}" data-budget-cat-child="${catIndex}">
            <td>${escapeHtml(item.description)}${item.vendor ? '<br><span style="color:var(--text-tertiary);font-size:11px">' + escapeHtml(item.vendor) + '</span>' : ''}</td>
            <td>${formatCurrency(item.budget)}</td>
            <td>${formatCurrency(item.actual)}</td>
            <td class="${itemVarianceClass}">${formatCurrency(item.variance)}</td>
            <td>${itemStatusBadge}</td>
          </tr>
        `;
      });

      const totalVarianceClass = cat.totalVariance < 0 ? 'variance-over' : 'variance-under';
      html += `
        <tr class="budget-row-total ${isOpen ? 'expanded' : ''}" data-budget-cat-child="${catIndex}">
          <td style="padding-left:40px;font-weight:600;">TOTAL</td>
          <td>${formatCurrency(cat.totalBudget)}</td>
          <td>${formatCurrency(cat.totalActual)}</td>
          <td class="${totalVarianceClass}">${formatCurrency(cat.totalVariance)}</td>
          <td></td>
        </tr>
      `;

      grandBudget += cat.budget;
      grandActual += cat.actual;
      grandVariance += cat.variance;
    });

    const grandVarianceClass = grandVariance < 0 ? 'variance-over' : 'variance-under';
    html += `
          <tr class="budget-row-grand">
            <td>TOTALS</td>
            <td>${formatCurrency(grandBudget)}</td>
            <td>${formatCurrency(grandActual)}</td>
            <td class="${grandVarianceClass}">${formatCurrency(grandVariance)}</td>
            <td></td>
          </tr>
        </tbody></table></div>
    `;
    return html;
  }

  function bindBudgetEvents() {
    document.querySelectorAll('[data-budget-cat]').forEach(row => {
      row.addEventListener('click', () => {
        const catIndex = parseInt(row.dataset.budgetCat);
        budgetExpandedCategories[catIndex] = !budgetExpandedCategories[catIndex];
        const toggle = row.querySelector('.budget-category-toggle');
        if (toggle) toggle.classList.toggle('open');
        document.querySelectorAll('[data-budget-cat-child="' + catIndex + '"]').forEach(child => {
          child.classList.toggle('expanded');
        });
      });
    });

    document.getElementById('budgetRefreshBtn')?.addEventListener('click', () => {
      fetchBudgetData();
    });

    document.getElementById('downloadBudgetPdfBtn')?.addEventListener('click', () => {
      const project = allProjects.find(p => p.id === (userProfile.projectId || adminSelectedProject));
      if (project) downloadBudgetPdf(project);
    });
  }

  function bindClientEvents() {
    document.getElementById('logoutBtn')?.addEventListener('click', logout);

    document.querySelectorAll('[data-client-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.clientNav;
        clientView = target;
        updateHash(false);
        var pid = userProfile.projectId;
        if (target === 'finances') {
          const proj = pid ? allProjects.find(p => p.id === pid) : null;
          const projHasSheet = proj && proj.googleSheetUrl && extractSheetId(proj.googleSheetUrl);
          if (projHasSheet) {
            // Sheets mode: always re-fetch live data on tab open
            budgetData = null;
            budgetFetchError = null;
            clientView = target;
            render();
            fetchBudgetData();
            return;
          } else if (firestoreBudgetItems.length === 0 && !firestoreBudgetLoading) {
            if (pid) { clientView = target; loadBudgetItems(pid); return; }
          }
          // Invoices are pre-loaded on login; re-load if somehow missing
          if (currentInvoices.length === 0 && !invoicesLoading && pid) loadInvoices(pid);
        }
        if (target === 'photos' && projectPhotos.length === 0 && !photosLoading) {
          if (pid) { loadPhotos(pid); return; }
        }
        if (target === 'documents' && projectDocuments.length === 0 && !documentsLoading) {
          if (pid) { loadDocuments(pid); return; }
        }
        if (target === 'selections' && projectSelections.length === 0 && !selectionsLoading) {
          if (pid) { loadSelections(pid); return; }
        }
        if (target === 'changeOrders' && currentChangeOrders.length === 0 && !changeOrdersLoading) {
          if (pid) {
            loadChangeOrders(pid).then(function() {
              bindClientChangeOrderEvents();
            });
            return;
          }
        }
        if (target === 'updates' && currentMessages.length === 0 && !messagesLoading) {
          if (pid) { loadMessages(pid); return; }
        }
        window.scrollTo(0, 0);
        render();
        if (target === 'updates' && pid) {
          bindUpdatesEvents(pid, 'client');
        }
        if (target === 'changeOrders') {
          bindClientChangeOrderEvents();
        }
        if (target === 'selections') {
          bindClientSelectionApproveEvents();
        }
      });
    });

    if (clientView === 'changeOrders') {
      bindClientChangeOrderEvents();
    }

    if (clientView === 'finances') {
      bindBudgetEvents();
      bindClientInvoiceEvents();
    }

    if (clientView === 'updates') {
      bindUpdatesEvents(userProfile.projectId, 'client');
    }

    // Client photo filter events
    if (clientView === 'photos') {
      document.querySelectorAll('[data-photo-filter]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          photoFilterPhase = btn.dataset.photoFilter;
          render();
        });
      });
    }

    // View all field notes button (dashboard → updates tab)
    var viewAllBtn = document.getElementById('viewAllFieldNotesBtn');
    if (viewAllBtn) {
      viewAllBtn.addEventListener('click', function() {
        clientView = 'updates';
        window.scrollTo(0, 0);
        render();
        var pid = userProfile.projectId;
        if (pid) bindUpdatesEvents(pid, 'client');
      });
    }

    // Phase calendar nav (dashboard timeline view)
    if (clientView === 'dashboard') {
      var clientCalProject = userProfile.projectId ? allProjects.find(function(p) { return p.id === userProfile.projectId; }) : null;
      if (clientCalProject) bindCalendarNav(clientCalProject.phases, 'clientTimeline');
    }

    // Client selection approve buttons (signature required)
    if (clientView === 'selections') {
      bindClientSelectionApproveEvents();
    }

    // Lightbox events
    bindLightboxEvents();
  }

  // ========================================
  // ADMIN VIEW
  // ========================================

  function renderAdminLayout() {
    return `
      <nav class="nav-bar">
        <div class="nav-logo">${PORTAL_CONFIG.companyName}<span>Admin Portal</span></div>
        <div class="nav-links">
          <button class="nav-link ${adminView === 'overview' || adminView === 'detail' ? 'active' : ''}" data-admin-nav="overview">Projects</button>
          <button class="nav-link ${adminView === 'clients' ? 'active' : ''}" data-admin-nav="clients">Clients</button>
          <button class="nav-link ${adminView === 'team' ? 'active' : ''}" data-admin-nav="team">Team</button>
          <button class="nav-link" id="logoutBtn">Logout</button>
        </div>
      </nav>
      <main class="main-content">
        ${adminView === 'overview' ? renderAdminOverview() : ''}
        ${adminView === 'detail' ? (adminPreviewClientView ? renderAdminClientPreview() : renderAdminDetail()) : ''}
        ${adminView === 'clients' ? renderAdminClients() : ''}
        ${adminView === 'team' ? renderAdminTeam() : ''}

      </main>
      <footer class="client-footer"><div class="client-footer-item" style="opacity:0.4;">Project Map — Powered by Dune</div></footer>
      ${showModal === 'addClient' ? renderAddClientModal() : ''}
      ${showModal === 'editClient' ? renderEditClientModal() : ''}
      ${showModal === 'addEmployee' ? renderAddEmployeeModal() : ''}
      ${showModal === 'newProject' ? renderNewProjectModal() : ''}
      ${showModal === 'editProject' ? renderEditProjectModal() : ''}
      ${showBudgetModal ? renderBudgetItemModal() : ''}
      ${lightboxPhoto ? '<div class="photo-lightbox" id="photoLightbox"><img src="' + escapeAttr(lightboxPhoto.url) + '" alt="' + escapeAttr(lightboxPhoto.caption) + '"><div class="photo-lightbox-caption">' + escapeHtml(lightboxPhoto.caption) + '</div></div>' : ''}
    `;
  }

  function renderAdminOverview() {
    // ── Dashboard: calculate stats from allProjects ──
    var totalProjects = allProjects.length;
    var phasesInProgress = 0;
    var phasesCompleted = 0;
    var phasesUpcoming = 0;
    allProjects.forEach(function(project) {
      if (!project.phases) return;
      project.phases.forEach(function(phase) {
        if (phase.status === 'in-progress') phasesInProgress++;
        else if (phase.status === 'completed') phasesCompleted++;
        else if (phase.status === 'upcoming') phasesUpcoming++;
      });
    });

    // ── Stats row ──
    var dashboardHtml = `
      <div class="budget-page-header"><h2 class="budget-page-title">Projects</h2><p class="budget-page-subtitle">Overview of all active builds.</p></div>

      <div class="dashboard-stats">
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-number">${totalProjects}</div>
          <div class="dashboard-stat-label">Active Projects</div>
        </div>
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-number">${phasesInProgress}</div>
          <div class="dashboard-stat-label">In Progress</div>
        </div>
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-number">${phasesCompleted}</div>
          <div class="dashboard-stat-label">Completed Phases</div>
        </div>
        <div class="dashboard-stat-card">
          <div class="dashboard-stat-number">${phasesUpcoming}</div>
          <div class="dashboard-stat-label">Upcoming</div>
        </div>
      </div>
    `;

    // ── QBO Connection Card ──
    if (PORTAL_CONFIG.qboClientId) {
      if (qboConnected) {
        dashboardHtml += '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:6px;margin-bottom:20px;">';
        dashboardHtml += '<div style="display:flex;align-items:center;gap:8px;"><span style="font-family:var(--font-nav);font-size:11px;font-weight:600;color:#1a7a1a;text-transform:uppercase;letter-spacing:0.08em;">&#10003; QuickBooks Connected</span></div>';
        dashboardHtml += '<button class="btn btn-secondary btn-small" id="disconnectQboBtn" style="font-size:9px;padding:4px 10px;color:var(--text-tertiary);">Disconnect</button>';
        dashboardHtml += '</div>';
      } else {
        dashboardHtml += '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--surface);border:1px solid var(--border);border-radius:6px;margin-bottom:20px;">';
        dashboardHtml += '<div>';
        dashboardHtml += '<div style="font-family:var(--font-nav);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary);">QuickBooks</div>';
        dashboardHtml += '<div style="font-family:var(--font-nav);font-size:11px;color:var(--text-tertiary);margin-top:2px;">Connect to sync invoices across all projects.</div>';
        dashboardHtml += '</div>';
        dashboardHtml += '<button class="btn btn-primary btn-small" id="connectQboBtn">Connect QuickBooks</button>';
        dashboardHtml += '</div>';
      }
    }

    // ── Project summary table ──
    if (allProjects.length > 0) {
      dashboardHtml += `
        <div class="dashboard-table-wrap">
          <div class="dashboard-section-title">Project Summary</div>
          <table class="dashboard-project-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Client</th>
                <th>Current Phase</th>
                <th style="min-width:140px">Progress</th>
              </tr>
            </thead>
            <tbody>
      `;

      allProjects.forEach(function(project) {
        var client = allUsers.find(function(u) { return u.id === project.clientId; });
        var clientName = client ? escapeHtml(client.name) : (project.clientName ? escapeHtml(project.clientName) : '—');
        var cp = getCurrentPhase(project);
        var cpNum = cp ? (project.phases ? project.phases.indexOf(cp) + 1 : 1) : 1;
        var cpDef = getPhaseDef(cpNum);
        var cpLabel = cp ? escapeHtml(cp.name || cpDef.name) : '—';
        var progress = getProjectProgress(project);

        // Progress bar color
        var fillColor;
        if (progress <= 33) {
          fillColor = 'var(--text-secondary)';
        } else if (progress <= 66) {
          fillColor = 'var(--accent, #C4A57B)';
        } else {
          fillColor = 'var(--primary, #1a1a1a)';
        }

        // Current phase status badge color
        var statusStyle = '';
        if (cp && cp.status === 'in-progress') {
          statusStyle = 'color:var(--text);font-weight:500;';
        } else if (cp && cp.status === 'completed') {
          statusStyle = 'color:var(--text-secondary);';
        } else {
          statusStyle = 'color:var(--text-tertiary);';
        }

        dashboardHtml += `
          <tr data-dashboard-project="${escapeAttr(project.id)}">
            <td style="font-family:var(--font-display);font-size:14px;font-weight:700;letter-spacing:0.02em;">${escapeHtml(project.name)}</td>
            <td style="color:var(--text-secondary);">${clientName}</td>
            <td style="${statusStyle}">Phase ${cpNum}: ${cpLabel}</td>
            <td>
              <div style="display:flex;align-items:center;gap:10px;">
                <div class="dashboard-progress-bar" style="flex:1;">
                  <div class="dashboard-progress-fill" style="width:${progress}%;background:${fillColor};"></div>
                </div>
                <span style="font-family:var(--font-nav);font-size:10px;color:var(--text-secondary);min-width:30px;text-align:right;">${progress}%</span>
              </div>
            </td>
          </tr>
        `;
      });

      dashboardHtml += `
            </tbody>
          </table>
        </div>
      `;
    }

    // ── Existing project cards ──
    dashboardHtml += `
      <div class="dashboard-section-title">All Projects</div>
      <div class="admin-overview">
    `;

    allProjects.forEach(function(project) {
      var client = allUsers.find(function(u) { return u.id === project.clientId; });
      var cp = getCurrentPhase(project);
      var cpNum = cp ? (project.phases ? project.phases.indexOf(cp) + 1 : 1) : 1;
      var cpDef = getPhaseDef(cpNum);
      var progress = getProjectProgress(project);
      dashboardHtml += `
        <div class="admin-project-card" data-project-id="${project.id}">
          <div class="admin-card-name">${escapeHtml(project.name)}</div>
          <div class="admin-card-location">${escapeHtml(project.location)}${client ? ' — ' + escapeHtml(client.name) : (project.clientName ? ' — ' + escapeHtml(project.clientName) : '')}</div>
          <div class="admin-card-meta">
            <span class="admin-card-phase">Phase ${cpNum}: ${cpDef.name}</span>
            <div class="admin-card-progress">
              <div class="admin-card-progress-bar" style="width:${progress}%"></div>
            </div>
          </div>
          <span class="admin-card-link">→ Manage Project</span>
              <button onclick="deleteProject('${project.id}', '${escapeHtml(project.name)}')" style="display:block;margin-top:12px;padding:4px 10px;background:transparent;color:var(--text-tertiary);border:1px solid var(--border);border-radius:4px;font-family:var(--font-nav);font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;cursor:pointer;transition:all 0.15s;" onmouseover="this.style.borderColor='#e74c3c';this.style.color='#e74c3c'" onmouseout="this.style.borderColor='';this.style.color=''">Delete</button>
        </div>
      `;
    });

    // New project card
    dashboardHtml += `
      <div class="admin-new-project-card" id="newProjectCard">
        <span>+ New Project</span>
      </div>
    `;

    dashboardHtml += '</div>';
    return dashboardHtml;
  }

  function renderAdminClientPreview() {
    const project = allProjects.find(p => p.id === adminSelectedProject);
    if (!project) return '<p>Project not found.</p>';

    // Temporarily set userProfile.projectId so client render functions work
    const origProjectId = userProfile.projectId;
    userProfile.projectId = adminSelectedProject;

    const previewNav = `
      <div style="background:#C4A57B;color:#fff;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;font-family:var(--font-nav);font-size:11px;text-transform:uppercase;letter-spacing:0.1em;">
        <span>\uD83D\uDC41 Client Preview Mode — ${escapeHtml(project.name)}</span>
        <button id="exitPreviewBtn" style="background:#1a1a1a;color:#FAF9F6;border:none;padding:6px 16px;font-family:var(--font-nav);font-size:10px;text-transform:uppercase;letter-spacing:0.1em;border-radius:4px;cursor:pointer;">\u2716 Exit Preview</button>
      </div>
    `;

    const clientNav = `
      <nav class="nav-bar">
        <div class="nav-logo">${PORTAL_CONFIG.companyName}<span>${PORTAL_CONFIG.tagline}</span></div>
        <div class="nav-links">
          <button class="nav-link ${clientView === 'dashboard' ? 'active' : ''}" data-client-nav="dashboard">Home</button>
          <button class="nav-link ${clientView === 'finances' ? 'active' : ''}" data-client-nav="finances">Finances</button>
          <button class="nav-link ${clientView === 'updates' ? 'active' : ''}" data-client-nav="updates">Updates</button>
          <button class="nav-link ${clientView === 'changeOrders' ? 'active' : ''}" data-client-nav="changeOrders">Approvals</button>
          <button class="nav-link ${clientView === 'selections' ? 'active' : ''}" data-client-nav="selections">Selections</button>
          <button class="nav-link ${clientView === 'documents' ? 'active' : ''}" data-client-nav="documents">Documents</button>
        </div>
      </nav>
    `;

    let content = '';
    if (clientView === 'finances') content = renderClientFinances(project);
    else if (clientView === 'documents') content = renderClientDocumentsTab(project);
    else if (clientView === 'selections') content = renderClientSelectionsTab(project);
    else if (clientView === 'changeOrders') content = renderClientChangeOrders(project);
    else if (clientView === 'updates') content = renderUpdatesTab(project, 'client');
    else content = renderClientDashboard(project);

    userProfile.projectId = origProjectId;

    return previewNav + clientNav + '<main class="main-content">' + content + '</main>';
  }

  function renderAdminDetail() {
    const project = allProjects.find(p => p.id === adminSelectedProject);
    if (!project) return '<p>Project not found.</p>';
    const client = allUsers.find(u => u.id === project.clientId);

    let html = `
      <button class="admin-detail-back" id="adminBackBtn">← Back to Projects</button>
      <div class="finances-page-header" style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:1px solid var(--border);">
        <div>
          <div class="finances-page-title">PROJECT</div>
          <div class="finances-page-subtitle">${escapeHtml(project.name)}</div>
          <div style="font-family:var(--font-nav);font-size:11px;color:var(--text-tertiary);margin-top:5px;">${escapeHtml(project.location)}${client ? ' — ' + escapeHtml(client.name) : ''}</div>
        </div>
        <button class="btn btn-secondary btn-small" id="previewClientViewBtn" style="font-size:10px;white-space:nowrap;margin-top:4px;">&#128065; Preview Client View</button>
      </div>

      <div class="admin-detail-tabs">
        <button class="admin-detail-tab ${adminDetailTab === 'details' ? 'active' : ''}" data-detail-tab="details">Details</button>
        <button class="admin-detail-tab ${adminDetailTab === 'phases' ? 'active' : ''}" data-detail-tab="phases">Timeline</button>
        <button class="admin-detail-tab ${adminDetailTab === 'budget' ? 'active' : ''}" data-detail-tab="budget">Budget</button>
        <button class="admin-detail-tab ${adminDetailTab === 'invoices' ? 'active' : ''}" data-detail-tab="invoices">Invoices</button>
        <button class="admin-detail-tab ${adminDetailTab === 'updates' ? 'active' : ''}" data-detail-tab="updates">Updates</button>
        <button class="admin-detail-tab ${adminDetailTab === 'changeOrders' ? 'active' : ''}" data-detail-tab="changeOrders">Change Orders</button>
        <button class="admin-detail-tab ${adminDetailTab === 'selections' ? 'active' : ''}" data-detail-tab="selections">Selections</button>
        <button class="admin-detail-tab ${adminDetailTab === 'documents' ? 'active' : ''}" data-detail-tab="documents">Documents</button>
      </div>

      <div class="admin-detail-tab-content">
    `;

    if (adminDetailTab === 'details') {
      html += renderAdminDetailsTab(project);
    } else if (adminDetailTab === 'phases') {
      html += renderAdminPhasesTab(project);
    } else if (adminDetailTab === 'budget') {
      html += renderAdminBudgetTab(project);
    } else if (adminDetailTab === 'updates') {
      html += renderAdminUpdatesTab(project);
    } else if (adminDetailTab === 'photos') {
      html += renderAdminPhotosTab(project);
    } else if (adminDetailTab === 'documents') {
      html += renderAdminDocumentsTab(project);
    } else if (adminDetailTab === 'selections') {
      html += renderAdminSelectionsTab(project);
    } else if (adminDetailTab === 'changeOrders') {
      html += renderAdminChangeOrdersTab(project);
    } else if (adminDetailTab === 'invoices') {
      html += renderAdminInvoicesTab(project);
    }

    html += '</div>';

    return html;
  }

  function renderAdminDetailsTab(project) {
    const clients = allUsers.filter(u => u.role === 'client');
    // Build QBO customer dropdown options
    var qboCustomerOptions = '<option value="">\u2014 No QBO Customer \u2014</option>';
    if (qboConnected && qboCustomers.length > 0) {
      qboCustomerOptions += qboCustomers.map(function(c) {
        var sel = c.id === (project.qboCustomerId || '') ? ' selected' : '';
        var label = escapeHtml(c.displayName) + (c.email ? ' (' + escapeHtml(c.email) + ')' : '');
        return '<option value="' + escapeAttr(c.id) + '"' + sel + '>' + label + '</option>';
      }).join('');
    }
    var qboSection = '';
    if (qboConnected) {
      qboSection = `
          <div class="admin-form-row">
            <div class="admin-form-group admin-form-full">
              <label>QuickBooks Customer <span style="font-weight:400;color:var(--text-tertiary);font-size:10px;">(used to sync invoices)</span></label>
              <select class="admin-select" name="qboCustomerId" id="qboCustomerDropdown">
                ${qboCustomerOptions}
              </select>
            </div>
          </div>`;
    }
    return `
      <div class="admin-section">
        <form id="adminProjectForm">
          <div class="admin-form-row">
            <div class="admin-form-group">
              <label>Project Name</label>
              <input class="admin-input" type="text" name="name" value="${escapeAttr(project.name)}">
            </div>
            <div class="admin-form-group">
              <label>Location</label>
              <input class="admin-input" type="text" name="location" value="${escapeAttr(project.location)}">
            </div>
          </div>
          <div class="admin-form-row">
            <div class="admin-form-group">
              <label>Start Date</label>
              <input class="admin-input" type="date" name="startDate" value="${project.startDate || ''}">
            </div>
            <div class="admin-form-group">
              <label>Est. Completion</label>
              <input class="admin-input" type="date" name="estCompletion" value="${project.estCompletion || ''}">
            </div>
          </div>
          <div class="admin-form-row">
            <div class="admin-form-group">
              <label>Client</label>
              <select class="admin-select" name="clientId">
                <option value="">— No Client —</option>
                ${clients.map(u => '<option value="' + u.id + '" ' + (u.id === project.clientId ? 'selected' : '') + '>' + escapeHtml(u.name) + ' (' + escapeHtml(u.email) + ')</option>').join('')}
              </select>
            </div>
          </div>
          <div class="admin-form-row">
            <div class="admin-form-group admin-form-full">
              <label>Hero Image URL <span style="font-weight:400;font-size:10px;color:var(--text-tertiary)">— shown behind the welcome banner on the client view</span></label>
              <input class="admin-input" type="url" name="heroImageUrl" value="${escapeAttr(project.heroImageUrl || '')}" placeholder="Paste image URL or Firebase Storage URL...">
            </div>
          </div>
          <div class="admin-form-row">
            <div class="admin-form-group admin-form-full">
              <label>Google Sheet URL</label>
              <input class="admin-input" type="url" name="googleSheetUrl" value="${escapeAttr(project.googleSheetUrl || '')}" placeholder="https://docs.google.com/spreadsheets/d/...">
            </div>
          </div>
          ${qboSection}
          <div class="btn-group">
            <button type="submit" class="btn btn-primary btn-small" id="saveDetailsBtn">Save Details</button>
            ${qboConnected ? '<button type="button" class="btn btn-secondary btn-small" id="loadQboCustomersBtn" style="margin-left:8px;">Refresh QBO Customers</button>' : ''}
          </div>
        </form>
      </div>
    `;
  }

  // ========================================
  // PHASE CALENDAR
  // ========================================

  const PHASE_COLORS = [
    '#C4A57B', // warm sand
    '#8A7B6B', // stone
    '#6B8A7B', // sage
    '#7B6B8A', // muted purple
    '#8A6B6B', // dusty rose
    '#6B7B8A', // slate blue
    '#A5956B', // amber
    '#6B8A86', // teal
  ];

  // Per-calendar state keyed by containerId
  var calendarStates = {};

  function getCalendarState(containerId) {
    if (!calendarStates[containerId]) {
      var now = new Date();
      calendarStates[containerId] = { month: now.getMonth(), year: now.getFullYear() };
    }
    return calendarStates[containerId];
  }

  function renderPhaseCalendar(phases, containerId) {
    var state = getCalendarState(containerId);
    var month = state.month;
    var year = state.year;

    var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    var today = new Date();
    today.setHours(0,0,0,0);

    // Build phase color map
    var phaseList = (phases || []).filter(function(p) { return p.startDate && p.endDate; });

    // First day of month and total days
    var firstDay = new Date(year, month, 1);
    var lastDay = new Date(year, month + 1, 0);
    var startDow = firstDay.getDay(); // 0=Sun
    var totalDays = lastDay.getDate();

    // Helper: get phase info for a given date
    function getPhaseForDate(d) {
      for (var pi = 0; pi < phaseList.length; pi++) {
        var p = phaseList[pi];
        var start = new Date(p.startDate + 'T00:00:00');
        var end = new Date(p.endDate + 'T00:00:00');
        if (d >= start && d <= end) {
          return { phase: p, colorIdx: pi % PHASE_COLORS.length };
        }
      }
      return null;
    }

    var html = '<div class="phase-calendar" id="' + containerId + 'Cal">';

    // Header
    html += '<div class="phase-cal-header">';
    html += '<button class="phase-cal-nav" data-cal-nav="prev" data-cal-id="' + containerId + '">\u2190</button>';
    html += '<span class="phase-cal-month">' + MONTH_NAMES[month] + ' ' + year + '</span>';
    html += '<button class="phase-cal-nav" data-cal-nav="next" data-cal-id="' + containerId + '">\u2192</button>';
    html += '</div>';

    // Grid
    html += '<div class="phase-cal-grid">';

    // Day headers
    DAY_NAMES.forEach(function(d) {
      html += '<div class="phase-cal-day-header">' + d + '</div>';
    });

    // Leading empty cells
    for (var e = 0; e < startDow; e++) {
      html += '<div class="phase-cal-day dimmed"></div>';
    }

    // Day cells
    for (var day = 1; day <= totalDays; day++) {
      var cellDate = new Date(year, month, day);
      cellDate.setHours(0,0,0,0);
      var isToday = (cellDate.getTime() === today.getTime());
      var phaseInfo = getPhaseForDate(cellDate);

      var classes = 'phase-cal-day';
      var style = '';
      var title = '';

      if (phaseInfo) {
        classes += ' has-phase';
        style = 'background:' + PHASE_COLORS[phaseInfo.colorIdx] + ';';
        title = ' title="' + escapeAttr(phaseInfo.phase.name || ('Phase ' + (phaseList.indexOf(phaseInfo.phase) + 1))) + '"';
      }
      if (isToday) {
        classes += ' today';
      }

      html += '<div class="' + classes + '" style="' + style + '"' + title + '>' + day + '</div>';
    }

    // Trailing empty cells to complete the grid
    var totalCells = startDow + totalDays;
    var remainder = totalCells % 7;
    if (remainder !== 0) {
      var trailing = 7 - remainder;
      for (var t = 0; t < trailing; t++) {
        html += '<div class="phase-cal-day dimmed"></div>';
      }
    }

    html += '</div>'; // end grid

    // Legend
    if (phaseList.length > 0) {
      html += '<div class="phase-cal-legend">';
      phaseList.forEach(function(p, pi) {
        var color = PHASE_COLORS[pi % PHASE_COLORS.length];
        var name = escapeHtml(p.name || ('Phase ' + (pi + 1)));
        html += '<div class="phase-cal-legend-item">';
        html += '<span class="phase-cal-legend-color" style="background:' + color + '"></span>';
        html += '<span>' + name + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    html += '</div>'; // end .phase-calendar
    return html;
  }

  function bindCalendarNav(phases, containerId) {
    // Use event delegation on the calendar element
    var calEl = document.getElementById(containerId + 'Cal');
    if (!calEl) return;
    calEl.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-cal-nav]');
      if (!btn) return;
      var dir = btn.getAttribute('data-cal-nav');
      var id = btn.getAttribute('data-cal-id');
      var state = getCalendarState(id);
      if (dir === 'prev') {
        state.month--;
        if (state.month < 0) { state.month = 11; state.year--; }
      } else {
        state.month++;
        if (state.month > 11) { state.month = 0; state.year++; }
      }
      var calContainer = document.getElementById(id + 'Cal');
      if (calContainer) {
        calContainer.outerHTML = renderPhaseCalendar(phases, id);
        bindCalendarNav(phases, id);
      }
    });
  }

  function renderAdminPhasesTab(project) {
    let tableHtml = '<div class="budget-page-header"><h2 class="budget-page-title">Timeline</h2><p class="budget-page-subtitle">' + escapeHtml(project.name) + '</p></div>';
    tableHtml += '<div class="admin-section"><table class="admin-table"><thead><tr><th>#</th><th>Phase</th><th>Status</th><th>Start</th><th>End</th></tr></thead><tbody>';

    (project.phases || []).forEach((phase, i) => {
      const def = getPhaseDef(i + 1);
      tableHtml += `
        <tr>
          <td>${String(i + 1).padStart(2, '0')}</td>
          <td><input class="admin-input" type="text" value="${escapeAttr(phase.name || def.name)}" data-phase-name="${i}" style="max-width:200px;padding:6px 8px;font-size:12px"></td>
          <td>
            <select class="admin-select" data-phase-status="${i}" style="max-width:140px;padding:6px 8px;font-size:12px">
              <option value="upcoming" ${phase.status === 'upcoming' ? 'selected' : ''}>Upcoming</option>
              <option value="in-progress" ${phase.status === 'in-progress' ? 'selected' : ''}>In Progress</option>
              <option value="completed" ${phase.status === 'completed' ? 'selected' : ''}>Completed</option>
            </select>
          </td>
          <td>
            <input class="admin-input" type="date" value="${phase.startDate || ''}" data-phase-date="${i}" data-date-type="start" style="max-width:150px;padding:6px 8px;font-size:12px">
          </td>
          <td>
            <input class="admin-input" type="date" value="${phase.endDate || ''}" data-phase-date="${i}" data-date-type="end" style="max-width:150px;padding:6px 8px;font-size:12px">
          </td>
        </tr>
      `;
    });

    tableHtml += '</tbody></table><div class="btn-group"><button class="btn btn-primary btn-small" id="savePhaseBtn">Save Phase Changes</button><button class="btn btn-secondary btn-small" id="addPhaseBtn" style="margin-left:8px">+ Add Phase</button><button class="btn btn-secondary btn-small" id="downloadPhasesPdfBtn" style="margin-left:8px">↓ Download PDF</button></div></div>';

    const calHtml = renderPhaseCalendar(project.phases, 'adminPhases');

    const html = '<div class="phases-layout"><div>' + tableHtml + '</div>' + calHtml + '</div>';
    return html;
  }

  // ========================================
  // SCHEMA-AGNOSTIC BUDGET HELPERS
  // Works for both old (camelCase) and new (snake_case) budget items
  // ========================================

  function budgetAmt(item)  { return Number(item.budget_amount  !== undefined ? item.budget_amount  : item.budgetAmount)  || 0; }
  function actualAmt(item)  { return Number(item.actual_amount  !== undefined ? item.actual_amount  : item.actualAmount)  || 0; }
  function itemCode(item)   { return item.cost_code   || item.costCode   || ''; }
  function itemName(item)   { return item.name        || item.costCode   || ''; }
  function itemCatName(item){ return item.top_level_name || item.category || ''; }
  function isNewSchema(item){ return item.cost_code   !== undefined; }
  function isTemplatedProject(project) {
    return project && project.budget_template_version === 'master_v1';
  }

  // ========================================
  // TEMPLATE BUDGET — GROUPING & TOTALS
  // ========================================

  function getTemplatedBudgetTotals() {
    var budget = 0, actual = 0;
    (firestoreBudgetItems || []).forEach(function(item) {
      // Only sum sub-codes (not category headers)
      if (item.parent_code !== null && item.parent_code !== undefined) {
        budget += budgetAmt(item);
        actual += actualAmt(item);
      }
    });
    return { budget: budget, actual: actual, variance: budget - actual };
  }

  function groupTemplatedBudget() {
    // Returns ordered array of { catCode, catName, header, active[], inactive[] }
    var groups = {};
    (firestoreBudgetItems || []).forEach(function(item) {
      var cat = item.top_level_category || '00';
      if (!groups[cat]) groups[cat] = { catCode: cat, catName: item.top_level_name || cat, header: null, active: [], inactive: [] };
      if (!item.parent_code) {
        groups[cat].header = item;
      } else if (item.active === false) {
        groups[cat].inactive.push(item);
      } else {
        groups[cat].active.push(item);
      }
    });
    // Sort by category code numerically
    return Object.keys(groups).sort(function(a,b){ return parseInt(a,10)-parseInt(b,10); }).map(function(k){ return groups[k]; });
  }

  // ========================================
  // TEMPLATE BUDGET ADMIN VIEW
  // ========================================

  // Suggest next sub-code for a category when adding a custom line
  function suggestNextCode(catCode) {
    var subs = firestoreBudgetItems.filter(function(i) {
      return i.top_level_category === catCode && i.parent_code;
    });
    if (!subs.length) return catCode + '.10';
    var maxNum = 0;
    subs.forEach(function(i) {
      var parts = (i.cost_code || '').split('.');
      var n = parseInt(parts[1], 10) || 0;
      if (n > maxNum) maxNum = n;
    });
    return catCode + '.' + (maxNum + 10);
  }

  // Inline edit row — replaces the line when in edit mode
  function renderTemplateBudgetLineEdit(item) {
    var costTypes = ['subcontractor','labor','material','equipment','fee','allowance','mixed'];
    var ctSelect = '<select class="tbudget-edit-select" id="tEdit_costType">';
    costTypes.forEach(function(t){
      ctSelect += '<option value="'+t+'"'+(t===(item.cost_type||'subcontractor')?' selected':'')+'>'+t+'</option>';
    });
    ctSelect += '</select>';
    return '<div class="tbudget-edit-row" data-editing-item="'+item.id+'">'
      + '<div class="tbudget-edit-fields">'
      + '<div class="tbudget-edit-field"><label>Code</label><input class="admin-input" id="tEdit_code" value="'+escapeAttr(item.cost_code||'')+'"></div>'
      + '<div class="tbudget-edit-field tbudget-edit-name"><label>Name</label><input class="admin-input" id="tEdit_name" value="'+escapeAttr(item.name||'')+'"></div>'
      + '<div class="tbudget-edit-field"><label>Cost Type</label>'+ctSelect+'</div>'
      + '<div class="tbudget-edit-field"><label>Vendor</label><input class="admin-input" id="tEdit_vendor" value="'+escapeAttr(item.vendor||'')+'"></div>'
      + '<div class="tbudget-edit-field tbudget-edit-notes"><label>Notes</label><input class="admin-input" id="tEdit_notes" value="'+escapeAttr(item.notes||'')+'"></div>'
      + '</div>'
      + '<div class="tbudget-edit-actions">'
      + '<button class="btn btn-primary btn-small" id="tEditSaveBtn" data-budget-item-save="'+item.id+'">Save</button>'
      + '<button class="btn btn-secondary btn-small" id="tEditCancelBtn" data-budget-item-cancel="'+item.id+'">Cancel</button>'
      + '</div>'
      + '</div>';
  }

  // Add custom line form — appears at bottom of an expanded category
  function renderTemplateBudgetAddRow(catCode, catName) {
    var suggested = suggestNextCode(catCode);
    var costTypes = ['subcontractor','labor','material','equipment','fee','allowance','mixed'];
    var ctSelect = '<select class="tbudget-edit-select" id="tAdd_costType">';
    costTypes.forEach(function(t){ ctSelect += '<option value="'+t+'"'+(t==='subcontractor'?' selected':'')+'>'+t+'</option>'; });
    ctSelect += '</select>';
    return '<div class="tbudget-add-row">'
      + '<div class="tbudget-edit-fields">'
      + '<div class="tbudget-edit-field"><label>Code</label><input class="admin-input" id="tAdd_code" value="'+escapeAttr(suggested)+'"></div>'
      + '<div class="tbudget-edit-field tbudget-edit-name"><label>Name <span style="color:#A0705A">*</span></label><input class="admin-input" id="tAdd_name" placeholder="e.g. Custom framing scope"></div>'
      + '<div class="tbudget-edit-field"><label>Cost Type</label>'+ctSelect+'</div>'
      + '<div class="tbudget-edit-field"><label>Vendor</label><input class="admin-input" id="tAdd_vendor" placeholder="Optional"></div>'
      + '</div>'
      + '<div class="tbudget-edit-actions">'
      + '<button class="btn btn-primary btn-small" id="tAddSaveBtn" data-add-to-cat="'+catCode+'" data-cat-name="'+escapeAttr(catName)+'">Add Line</button>'
      + '<button class="btn btn-secondary btn-small" id="tAddCancelBtn">Cancel</button>'
      + '</div>'
      + '</div>';
  }

  // Save edits to an existing budget line
  async function saveBudgetLineEdit(projectId, itemId) {
    var code   = (document.getElementById('tEdit_code')?.value || '').trim();
    var name   = (document.getElementById('tEdit_name')?.value || '').trim();
    var ctype  = document.getElementById('tEdit_costType')?.value || 'subcontractor';
    var vendor = (document.getElementById('tEdit_vendor')?.value || '').trim();
    var notes  = (document.getElementById('tEdit_notes')?.value || '').trim();
    if (!name) { showToast('Name is required.'); return; }
    var update = {
      cost_code: code,
      name:      name,
      cost_type: ctype,
      vendor:    vendor || null,
      notes:     notes  || null,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };
    // Optimistic update in memory
    var item = firestoreBudgetItems.find(function(i){ return i.id === itemId; });
    if (item) Object.assign(item, update);
    budgetEditingLine = null;
    render();
    await db.collection('projects').doc(projectId)
      .collection('budgetItems').doc(itemId).update(update);
  }

  // Add a brand-new custom line to a category
  async function addCustomBudgetLine(projectId, catCode, catName) {
    var code   = (document.getElementById('tAdd_code')?.value || '').trim();
    var name   = (document.getElementById('tAdd_name')?.value || '').trim();
    var ctype  = document.getElementById('tAdd_costType')?.value || 'subcontractor';
    var vendor = (document.getElementById('tAdd_vendor')?.value || '').trim();
    if (!name) { showToast('Name is required.'); return; }
    var sortNum = firestoreBudgetItems
      .filter(function(i){ return i.top_level_category === catCode; })
      .reduce(function(m,i){ return Math.max(m, i.sort_order||0); }, 0) + 5;
    var newItem = {
      cost_code:          code || catCode + '.custom',
      parent_code:        catCode,
      name:               name,
      description:        '',
      sort_order:         sortNum,
      top_level_category: catCode,
      top_level_name:     catName,
      cost_type:          ctype,
      vendor:             vendor || null,
      notes:              null,
      help_text:          null,
      client_visible:     false,
      billable:           true,
      is_allowance:       false,
      is_selection:       false,
      is_change_order:    false,
      is_contingency:     false,
      fee_bucket:         'none',
      active:             true,
      selection_status:   null,
      budget_amount:      null,
      actual_amount:      null,
      status:             'not_started',
      seeded_from:        'custom',
      created_at:         firebase.firestore.FieldValue.serverTimestamp(),
      updated_at:         firebase.firestore.FieldValue.serverTimestamp()
    };
    budgetAddingToCategory = null;
    var ref = await db.collection('projects').doc(projectId)
      .collection('budgetItems').add(newItem);
    firestoreBudgetItems.push(Object.assign({ id: ref.id }, newItem));
    budgetCategoryOpen[catCode] = true; // keep category open
    render();
    showToast('Line added.');
  }

  // Delete a budget line with confirmation
  async function deleteBudgetLine(projectId, itemId, itemName) {
    if (!confirm('Delete \u201c' + (itemName||'this line') + '\u201d? This cannot be undone.')) return;
    firestoreBudgetItems = firestoreBudgetItems.filter(function(i){ return i.id !== itemId; });
    render();
    await db.collection('projects').doc(projectId)
      .collection('budgetItems').doc(itemId).delete();
    showToast('Line deleted.');
  }

  // ========================================
  // TEMPLATE RESTORE — load master, detect missing, restore
  // ========================================

  // Load master template into memory (once per session)
  async function loadMasterTemplateCache() {
    if (cachedTemplate || cachedTemplateLoading || cachedTemplateFailed) return;
    cachedTemplateLoading = true;
    try {
      var snap = await db.collection('costCodeTemplates').doc('master_v1').collection('codes').get();
      cachedTemplate = [];
      snap.forEach(function(doc) { cachedTemplate.push(doc.data()); });
      console.log('[Restore] Template loaded: ' + cachedTemplate.length + ' codes');
    } catch(e) {
      console.error('[Restore] Failed to load template:', e);
      cachedTemplateFailed = true;
    }
    cachedTemplateLoading = false;
    // Re-render so missing-line counts appear (only on success)
    if (cachedTemplate && adminDetailTab === 'budget') render();
  }

  // Apply the same filters as seedProjectBudget to get what SHOULD be in this project
  function filterTemplateForProject(project) {
    if (!cachedTemplate || !project) return [];
    var tier       = project.budget_tier              || 'standard';
    var ptype      = project.budget_project_type      || 'new_build';
    var modules    = project.budget_modules           || [];
    var inclRemodel = project.budget_remodel_conditions === true;
    return cachedTemplate.filter(function(r) {
      if (!r.tiers || r.tiers.indexOf(tier)   === -1) return false;
      if (!r.project_types || r.project_types.indexOf(ptype) === -1) return false;
      if (r.module !== null && r.module !== undefined && modules.indexOf(r.module) === -1) return false;
      if (r.top_level_category === '26' && !inclRemodel) return false;
      return true;
    });
  }

  // Return template lines that are missing from the current project (optionally scoped to a category)
  function getMissingTemplateLines(project, catCode) {
    var shouldExist   = filterTemplateForProject(project);
    var currentCodes  = {};
    firestoreBudgetItems.forEach(function(i) { currentCodes[i.cost_code] = true; });
    return shouldExist.filter(function(r) {
      if (!r.parent_code) return false; // skip category headers
      if (catCode && r.top_level_category !== catCode) return false;
      return !currentCodes[r.cost_code];
    });
  }

  // Restore missing template lines (for a category or the whole budget)
  async function restoreMissingLines(projectId, project, catCode) {
    var missing = getMissingTemplateLines(project, catCode || null);
    if (!missing.length) { showToast('Nothing to restore — all template lines are present.'); return; }

    var batch    = db.batch();
    var budgetRef = db.collection('projects').doc(projectId).collection('budgetItems');
    var nowStamp  = firebase.firestore.FieldValue.serverTimestamp();

    missing.forEach(function(r) {
      var newItem = {
        cost_code:          r.cost_code,
        parent_code:        r.parent_code || null,
        name:               r.name,
        description:        r.description || '',
        sort_order:         r.sort_order  || 0,
        top_level_category: r.top_level_category,
        top_level_name:     r.top_level_name,
        cost_type:          r.cost_type   || 'subcontractor',
        help_text:          r.help_text   || null,
        client_visible:     r.client_visible === true,
        billable:           r.billable !== false,
        is_allowance:       r.is_allowance  === true,
        is_selection:       r.is_selection  === true,
        is_change_order:    r.is_change_order === true,
        is_contingency:     r.is_contingency  === true,
        fee_bucket:         r.fee_bucket   || 'none',
        active:             r.active_by_default !== false,
        budget_amount:      null,
        actual_amount:      null,
        selection_status:   r.is_allowance ? 'not_started' : null,
        vendor:             null,
        notes:              null,
        status:             'not_started',
        seeded_from:        'master_v1',
        created_at:         nowStamp,
        updated_at:         nowStamp
      };
      var ref = budgetRef.doc();
      batch.set(ref, newItem);
      firestoreBudgetItems.push(Object.assign({ id: ref.id }, newItem));
    });

    await batch.commit();

    if (catCode) budgetCategoryOpen[catCode] = true;
    render();
    showToast(missing.length + ' line' + (missing.length !== 1 ? 's' : '') + ' restored from template.');
  }

  function renderTemplateBudgetLine(item, inactive) {
    // Show inline edit form if this line is being edited
    if (budgetEditingLine === item.id) return renderTemplateBudgetLineEdit(item);

    var b  = budgetAmt(item);
    var a  = actualAmt(item);
    var v  = b - a;
    var vc = v < 0 ? 'variance-over' : (b > 0 ? 'variance-under' : '');
    var st = item.status || 'not_started';
    var statuses = [['not_started','Not Started'],['in_progress','In Progress'],['complete','Complete'],['on_hold','On Hold'],['excluded','Excluded']];
    var selHtml = '<select class="tbudget-status" data-budget-item-status="' + item.id + '">';
    statuses.forEach(function(s){ selHtml += '<option value="'+s[0]+'"'+(s[0]===st?' selected':'')+'>'+s[1]+'</option>'; });
    selHtml += '</select>';
    var helpIcon = item.help_text ? ' <span class="tbudget-help" title="'+escapeAttr(item.help_text)+'">?</span>' : '';
    var customBadge = item.seeded_from === 'custom' ? ' <span class="tbudget-custom-badge">Custom</span>' : '';
    var inactiveBadge = inactive ? '<span class="tbudget-inactive-badge">Optional</span>' : '';
    return '<div class="tbudget-line'+(inactive?' inactive':'')+'">'
      + '<span class="tbudget-line-code">'+escapeHtml(item.cost_code)+'</span>'
      + '<span class="tbudget-line-name">'+escapeHtml(item.name)+helpIcon+customBadge+inactiveBadge+'</span>'
      + '<span class="tbudget-line-budget"><input type="number" class="tbudget-input" data-budget-field="budget_amount" data-budget-item="'+item.id+'" value="'+(b||'')+'" placeholder="—" min="0" step="1"></span>'
      + '<span class="tbudget-line-actual"><input type="number" class="tbudget-input" data-budget-field="actual_amount" data-budget-item="'+item.id+'" value="'+(a||'')+'" placeholder="—" min="0" step="1"></span>'
      + '<span class="tbudget-line-variance '+vc+'">'+(b>0||a>0 ? formatCurrency(v) : '—')+'</span>'
      + '<span class="tbudget-line-status">'+selHtml+'</span>'
      + '<span class="tbudget-line-actions">'
      + '<button class="tbudget-action-edit" data-budget-item-edit="'+item.id+'" title="Edit line">✎</button>'
      + '<button class="tbudget-action-delete" data-budget-item-delete="'+item.id+'" data-item-name="'+escapeAttr(item.name||'')+'" title="Delete line">✕</button>'
      + '</span>'
      + '</div>';
  }

  function renderTemplateBudgetAdmin(project) {
    var groups = groupTemplatedBudget();
    var totals  = getTemplatedBudgetTotals();
    var pct     = totals.budget > 0 ? Math.min(100, (totals.actual / totals.budget) * 100) : 0;

    if (!groups.length) {
      return '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading budget…</span></div>';
    }

    var html = '';

    // ── Page header ────────────────────────────────────────────────────────────────────
    html += '<div class="budget-page-header">';
    html += '<h2 class="budget-page-title">Budget</h2>';
    html += '<p class="budget-page-subtitle">' + escapeHtml(project.name) + '</p>';
    html += '</div>';

    // ── Budget Overview Card ────────────────────────────────────────────────────────
    html += '<div class="finances-overview-card">';
    html += '<div class="finances-overview-eyebrow">Budget Overview</div>';
    html += '<div class="finances-kpi-row">';
    html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Total Budget</div><div class="finances-kpi-value" id="tbudget-total-budget">' + formatCurrency(totals.budget) + '</div></div>';
    html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Total Spent</div><div class="finances-kpi-value" id="tbudget-total-actual">' + formatCurrency(totals.actual) + '</div></div>';
    html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Remaining</div><div class="finances-kpi-value ' + (totals.variance < 0 ? 'negative' : (totals.variance > 0 ? 'positive' : '')) + '" id="tbudget-total-variance">' + formatCurrency(totals.variance) + '</div></div>';
    html += '<div class="finances-kpi-item"><div class="finances-kpi-label">% Spent</div><div class="finances-kpi-value ' + (pct >= 100 ? 'negative' : '') + '" id="tbudget-progress-label">' + pct.toFixed(1) + '%</div></div>';
    html += '</div>';
    html += '<div class="finances-progress-track"><div class="finances-progress-fill" id="tbudget-progress-fill" style="width:' + Math.min(100, pct).toFixed(1) + '%;' + (pct >= 100 ? 'background:#924014;' : '') + '"></div></div>';

    // ── Info bar + global restore ──────────────────────────────────────────────────────────────
    var tier = project.budget_tier || 'standard';
    var ptype = project.budget_project_type || '';
    var ctype = project.budget_contract_type || '';
    var tierLabel  = tier.charAt(0).toUpperCase() + tier.slice(1);
    var ptypeLabel = { new_build:'New Build', remodel:'Remodel', addition:'Addition', adu:'ADU' }[ptype] || ptype;
    var ctypeLabel = { cost_plus:'Cost-Plus', fixed_price:'Fixed-Price', gmp:'GMP' }[ctype] || ctype;
    var totalMissing = cachedTemplate ? getMissingTemplateLines(project, null).length : -1;
    var restoreAllBtn = totalMissing > 0
      ? '<button class="tbudget-restore-all" id="tRestoreAllBtn">&#8635; Restore missing ('+totalMissing+')</button>'
      : (totalMissing === 0 ? '<span class="tbudget-all-present">✓ All template lines present</span>' : '');
    html += '<div class="tbudget-info-bar">'
      + '<span>Template: <strong>'+tierLabel+'</strong></span>'
      + '<span>Type: <strong>'+ptypeLabel+'</strong></span>'
      + '<span>Contract: <strong>'+ctypeLabel+'</strong></span>'
      + '<span><strong>'+firestoreBudgetItems.length+'</strong> lines</span>'
      + (restoreAllBtn ? '<span style="margin-left:auto">'+restoreAllBtn+'</span>' : '')
      + '</div>';
    html += '</div>'; // close .finances-overview-card

    // ── Budget Breakdown Card ─────────────────────────────────────────────────────
    html += '<div class="finances-content-card">';
    html += '<div class="finances-content-card-header finances-content-card-header--warm">';
    html += '<div class="finances-content-card-title">Budget Breakdown</div>';
    html += '<div class="finances-content-card-desc">Tap a category to expand and edit line items.</div>';
    html += '</div>';
    html += '<div class="finances-content-card-body" style="padding:0;">';

    // ── Column headers ─────────────────────────────────────────────────────────────────
    html += '<div class="tbudget-col-headers">'
      + '<span>Code</span><span>Description</span><span>Budget ($)</span><span>Actual ($)</span><span>Variance</span><span>Status</span><span></span>'
      + '</div>';

    // ── Category rows ─────────────────────────────────────────────────────────────────
    html += '<div class="tbudget-list">';

    groups.forEach(function(grp) {
      var isOpen     = budgetCategoryOpen[grp.catCode] === true;
      var optOpen    = budgetCategoryOpen[grp.catCode + '_opt'] === true;
      var allLines   = grp.active.concat(grp.inactive);
      var catBudget  = allLines.reduce(function(s,i){ return s + budgetAmt(i); }, 0);
      var catActual  = allLines.reduce(function(s,i){ return s + actualAmt(i); }, 0);
      var catVariance = catBudget - catActual;
      var vc = catVariance < 0 ? 'variance-over' : (catBudget > 0 ? 'variance-under' : '');

      html += '<div class="tbudget-category">';

      // Category-level missing count
      var catMissing = cachedTemplate ? getMissingTemplateLines(project, grp.catCode).length : 0;
      var catRestoreBtn = catMissing > 0
        ? '<button class="tbudget-cat-restore" data-restore-cat="'+grp.catCode+'" title="Restore '+catMissing+' missing line'+(catMissing>1?'s':'')+'">&#8635; '+catMissing+'</button>'
        : '';

      // Category header row
      html += '<div class="tbudget-cat-header" data-toggle-cat="'+grp.catCode+'">'
        + '<div class="tbudget-cat-left">'
        + '<span class="tbudget-cat-chevron">'+(isOpen?'▼':'▶')+'</span>'
        + '<span class="tbudget-cat-code">'+grp.catCode+'</span>'
        + '<span class="tbudget-cat-name">'+escapeHtml(grp.catName)+'</span>'
        + '<span class="tbudget-cat-count">'+(grp.active.length+grp.inactive.length)+' lines'+(grp.inactive.length?' ('+grp.inactive.length+' optional)':'')+'</span>'
        + catRestoreBtn
        + '</div>'
        + '<div class="tbudget-cat-right">'
        + '<span class="tbudget-cat-budget">'+(catBudget>0?formatCurrency(catBudget):'—')+'</span>'
        + '<span class="tbudget-cat-actual">'+(catActual>0?formatCurrency(catActual):'—')+'</span>'
        + '<span class="tbudget-cat-variance '+vc+'">'+(catBudget>0||catActual>0?formatCurrency(catVariance):'—')+'</span>'
        + '</div>'
        + '</div>';

      if (isOpen) {
        html += '<div class="tbudget-lines">';

        // Active lines
        grp.active.forEach(function(item) {
          html += renderTemplateBudgetLine(item, false);
        });

        // Optional / inactive lines
        if (grp.inactive.length) {
          html += '<div class="tbudget-optional-toggle" data-toggle-cat="'+grp.catCode+'_opt">'
            + (optOpen?'▼':'▶')+' Optional lines ('+grp.inactive.length+')</div>';
          if (optOpen) {
            grp.inactive.forEach(function(item) {
              html += renderTemplateBudgetLine(item, true);
            });
          }
        }

        // Add custom line form or + button
        if (budgetAddingToCategory === grp.catCode) {
          html += renderTemplateBudgetAddRow(grp.catCode, grp.catName);
        } else {
          html += '<div class="tbudget-add-btn-row">'
            + '<button class="tbudget-add-btn" data-add-line-cat="'+grp.catCode+'">+ Add line</button>'
            + '</div>';
        }

        html += '</div>'; // .tbudget-lines
      }

      html += '</div>'; // .tbudget-category
    });

    html += '</div>'; // .tbudget-list
    html += '</div>'; // .finances-content-card-body
    html += '</div>'; // .finances-content-card
    return html;
  }

  function renderAdminBudgetTab(project) {
    const hasSheet = project && project.googleSheetUrl && extractSheetId(project.googleSheetUrl);

    // ── GOOGLE SHEETS MODE ──────────────────────────────────────
    if (hasSheet) {
      return renderSheetModeBudgetAdmin(project);
    }

    // ── TEMPLATE BUDGET MODE (seeded from master template) ──────
    if (isTemplatedProject(project)) {
      if (firestoreBudgetLoading) {
        return '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading budget…</span></div>';
      }
      return renderTemplateBudgetAdmin(project);
    }

    // ── LEGACY PORTAL EDITOR MODE ───────────────────────────────
    if (firestoreBudgetLoading) {
      return '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading budget data...</span></div>';
    }

    const totals = getFirestoreBudgetTotals();
    const pctSpent = totals.budget > 0 ? Math.min(100, (totals.actual / totals.budget) * 100) : 0;
    const grouped = groupBudgetItemsByCategory();
    const hasItems = firestoreBudgetItems.length > 0;

    let html = '';

    // ── Budget Overview Card ────────────────────────────────────────────────────────
    if (hasItems) {
      html += '<div class="finances-overview-card">';
      html += '<div class="finances-overview-eyebrow">Budget Overview</div>';
      html += '<div class="finances-kpi-row">';
      html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Total Budget</div><div class="finances-kpi-value">' + formatCurrency(totals.budget) + '</div></div>';
      html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Total Spent</div><div class="finances-kpi-value">' + formatCurrency(totals.actual) + '</div></div>';
      html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Remaining</div><div class="finances-kpi-value ' + (totals.variance < 0 ? 'negative' : (totals.variance > 0 ? 'positive' : '')) + '">' + formatCurrency(totals.variance) + '</div></div>';
      html += '<div class="finances-kpi-item"><div class="finances-kpi-label">% Spent</div><div class="finances-kpi-value ' + (pctSpent >= 100 ? 'negative' : '') + '">' + pctSpent.toFixed(1) + '%</div></div>';
      html += '</div>';
      html += '<div class="finances-progress-track"><div class="finances-progress-fill" style="width:' + Math.min(100, pctSpent).toFixed(1) + '%;' + (pctSpent >= 100 ? 'background:#924014;' : '') + '"></div></div>';
      html += '</div>'; // .finances-overview-card
    }

    // ── Budget Breakdown Card ────────────────────────────────────────────────────────
    html += '<div class="finances-content-card">';
    html += '<div class="finances-content-card-header finances-content-card-header--warm">';
    html += '<div class="finances-content-card-title">Budget Breakdown</div>';
    html += '<div class="finances-content-card-desc" style="display:flex;align-items:center;justify-content:space-between;">';
    html += '<span>Line items grouped by category.</span>';
    html += '<span style="display:flex;gap:8px;">';
    html += '<button class="btn btn-primary btn-small" id="addBudgetItemBtn">+ Add Line Item</button>';
    html += '<button class="btn btn-secondary btn-small" id="downloadBudgetPdfBtn">\u2193 Download PDF</button>';
    html += '</span>';
    html += '</div>';
    html += '</div>';
    html += '<div class="finances-content-card-body" style="padding:0;">';

    if (!hasItems) {
      html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Budget Items</div><div class="finances-invoices-empty-msg">Add line items above, or link a Google Sheet in the Details tab.</div></div>';
      html += '</div></div>'; // close card body + card
      return html;
    }

    // Budget table grouped by category
    html += '<div class="admin-budget-table-wrapper"><table class="admin-budget-table"><thead><tr>';
    html += '<th>Cost Code</th><th>Vendor</th><th class="right">Budget</th><th class="right">Actual</th><th class="right">Variance</th><th>Status</th><th>Actions</th>';
    html += '</tr></thead><tbody>';

    let grandBudget = 0, grandActual = 0;

    const categoryNames = Object.keys(grouped);
    categoryNames.forEach(catName => {
      const items = grouped[catName];
      let catBudget = 0, catActual = 0;
      items.forEach(it => { catBudget += Number(it.budgetAmount) || 0; catActual += Number(it.actualAmount) || 0; });

      html += '<tr class="cat-header-row"><td colspan="7">' + escapeHtml(catName) + '</td></tr>';

      items.forEach(item => {
        const budget = Number(item.budgetAmount) || 0;
        const actual = Number(item.actualAmount) || 0;
        const variance = budget - actual;
        const varianceClass = variance < 0 ? 'variance-over' : 'variance-under';
        const statusLabel = item.status === 'complete' ? 'Complete' : item.status === 'in-progress' ? 'In Progress' : 'Pending';
        const statusClass = item.status === 'complete' ? 'budget-status-complete' : item.status === 'in-progress' ? 'budget-status-in-progress' : 'budget-status-pending';

        html += '<tr>';
        html += '<td>' + escapeHtml(item.costCode) + (item.description ? '<br><span style="color:var(--text-tertiary);font-size:11px">' + escapeHtml(item.description) + '</span>' : '') + '</td>';
        html += '<td>' + escapeHtml(item.vendor || '') + '</td>';
        html += '<td class="right">' + formatCurrency(budget) + '</td>';
        html += '<td class="right">' + formatCurrency(actual) + '</td>';
        html += '<td class="right ' + varianceClass + '">' + formatCurrency(variance) + '</td>';
        html += '<td><span class="budget-status-badge ' + statusClass + '">' + statusLabel + '</span></td>';
        html += '<td style="white-space:nowrap"><button class="budget-action-btn edit" data-edit-budget="' + item.id + '">Edit</button><button class="budget-action-btn delete" data-delete-budget="' + item.id + '">Delete</button></td>';
        html += '</tr>';
      });

      grandBudget += catBudget;
      grandActual += catActual;
    });

    const grandVariance = grandBudget - grandActual;
    const grandVarianceClass = grandVariance < 0 ? 'variance-over' : 'variance-under';
    html += '<tr class="grand-total-row">';
    html += '<td>Totals</td><td></td>';
    html += '<td class="right">' + formatCurrency(grandBudget) + '</td>';
    html += '<td class="right">' + formatCurrency(grandActual) + '</td>';
    html += '<td class="right ' + grandVarianceClass + '">' + formatCurrency(grandVariance) + '</td>';
    html += '<td></td><td></td></tr>';

    html += '</tbody></table></div>';
    html += '</div>'; // .finances-content-card-body
    html += '</div>'; // .finances-content-card
    html += '<p class="budget-sheet-hint">Want to sync from a spreadsheet? Add a Google Sheet URL in the Details tab.</p>';

    return html;
  }

  // Renders the admin budget tab when a Google Sheet is linked (read-only, live-synced)
  function renderSheetModeBudgetAdmin(project) {
    const editUrl = getSheetsEditUrl(project.googleSheetUrl);
    const syncTime = budgetLastSynced
      ? budgetLastSynced.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
        budgetLastSynced.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      : null;

    let html = '';

    // Sheet linked banner
    html += '<div class="budget-sheet-banner">';
    html += '<div class="budget-sheet-banner-text">';
    html += '<span class="budget-sheet-banner-icon">&#8596;</span>';
    html += '<span>Budget linked to Google Sheets — data syncs live from your spreadsheet</span>';
    html += '</div>';
    html += '<div class="budget-sheet-banner-actions">';
    if (editUrl) {
      html += '<a href="' + escapeAttr(editUrl) + '" target="_blank" class="btn btn-secondary btn-small" style="text-decoration:none">Edit in Google Sheets &#8599;</a>';
    }
    html += '<button class="btn btn-secondary btn-small" id="sheetBudgetRefreshBtn">&#8635; Refresh</button>';
    html += '<button class="btn btn-secondary btn-small" id="downloadBudgetPdfBtn">&#8595; Download PDF</button>';
    html += '<button class="budget-unlink-btn" id="unlinkSheetBtn">Unlink Sheet</button>';
    html += '</div>';
    html += '</div>';

    // Loading state
    if (budgetLoading) {
      html += '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Fetching from Google Sheets...</span></div>';
      return html;
    }

    // Error state
    if (budgetFetchError) {
      html += '<div class="budget-fetch-error">';
      html += '<p class="budget-fetch-error-msg">&#9888; Could not load budget data: ' + escapeHtml(budgetFetchError) + '</p>';
      html += '<button class="btn btn-secondary btn-small" id="sheetBudgetRefreshBtn" style="margin-top:12px">Retry</button>';
      html += '</div>';
      return html;
    }

    // Not yet fetched
    if (!budgetData) {
      html += '<div class="budget-loading"><span class="budget-loading-text">Opening the Budget tab fetches live data automatically.</span></div>';
      return html;
    }

    // ── Budget Overview Card ────────────────────────────────────────────────────────
    html += '<div class="finances-overview-card">';
    html += '<div class="finances-overview-eyebrow">Budget Overview</div>';
    // Compute sheet totals for KPI row
    var sheetBudgetTotal = 0, sheetActualTotal = 0;
    budgetData.forEach(function(cat) { sheetBudgetTotal += cat.budget || 0; sheetActualTotal += cat.actual || 0; });
    var sheetRemaining = sheetBudgetTotal - sheetActualTotal;
    var sheetPct = sheetBudgetTotal > 0 ? Math.min(100, (sheetActualTotal / sheetBudgetTotal) * 100) : 0;
    html += '<div class="finances-kpi-row">';
    html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Total Budget</div><div class="finances-kpi-value">' + formatCurrency(sheetBudgetTotal) + '</div></div>';
    html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Total Spent</div><div class="finances-kpi-value">' + formatCurrency(sheetActualTotal) + '</div></div>';
    html += '<div class="finances-kpi-item"><div class="finances-kpi-label">Remaining</div><div class="finances-kpi-value ' + (sheetRemaining < 0 ? 'negative' : (sheetRemaining > 0 ? 'positive' : '')) + '">' + formatCurrency(sheetRemaining) + '</div></div>';
    html += '<div class="finances-kpi-item"><div class="finances-kpi-label">% Spent</div><div class="finances-kpi-value ' + (sheetPct >= 100 ? 'negative' : '') + '">' + sheetPct.toFixed(1) + '%</div></div>';
    html += '</div>';
    html += '<div class="finances-progress-track"><div class="finances-progress-fill" style="width:' + Math.min(100, sheetPct).toFixed(1) + '%;' + (sheetPct >= 100 ? 'background:#924014;' : '') + '"></div></div>';
    if (syncTime) {
      html += '<div class="finances-sync-row"><span class="finances-sync-label">Last synced ' + escapeHtml(syncTime) + '</span></div>';
    }
    html += '</div>'; // .finances-overview-card

    // ── Budget Breakdown Card ────────────────────────────────────────────────────────
    html += '<div class="finances-content-card">';
    html += '<div class="finances-content-card-header finances-content-card-header--warm">';
    html += '<div class="finances-content-card-title">Budget Breakdown</div>';
    html += '<div class="finances-content-card-desc">Synced from Google Sheets. Tap any category to expand.</div>';
    html += '</div>';
    html += '<div class="finances-content-card-body--table">';
    html += '<div class="budget-table-wrapper"><table class="budget-table"><thead><tr>';
    html += '<th>Cost Code</th><th>Budget</th><th>Actual</th><th>Variance</th><th>Status</th>';
    html += '</tr></thead><tbody>';

    let grandBudget = 0, grandActual = 0, grandVariance = 0;

    budgetData.forEach(function(cat, catIndex) {
      const isOpen = budgetExpandedCategories[catIndex] === true;
      const catVarianceClass = cat.variance < 0 ? 'variance-over' : 'variance-under';
      const catStatusBadge = cat.status === '100%'
        ? '<span class="budget-status-badge budget-status-complete">Complete</span>'
        : (cat.actual > 0 ? '<span class="budget-status-badge budget-status-in-progress">In Progress</span>' : '');

      html += '<tr class="budget-row-category" data-budget-cat="' + catIndex + '">';
      html += '<td><span class="budget-category-toggle ' + (isOpen ? 'open' : '') + '">&#9654;</span>' + escapeHtml(cat.name) + '</td>';
      html += '<td>' + formatCurrency(cat.budget) + '</td>';
      html += '<td>' + formatCurrency(cat.actual) + '</td>';
      html += '<td class="' + catVarianceClass + '">' + formatCurrency(cat.variance) + '</td>';
      html += '<td>' + catStatusBadge + '</td></tr>';

      cat.subItems.forEach(function(item) {
        const itemVarianceClass = item.variance < 0 ? 'variance-over' : 'variance-under';
        const itemStatusBadge = (item.status === '100%' || item.status === '100' || item.status === '1')
          ? '<span class="budget-status-badge budget-status-complete">Complete</span>' : '';
        html += '<tr class="budget-row-sub ' + (isOpen ? 'expanded' : '') + '" data-budget-cat-child="' + catIndex + '">';
        html += '<td>' + escapeHtml(item.description) + (item.vendor ? '<br><span style="color:var(--text-tertiary);font-size:11px">' + escapeHtml(item.vendor) + '</span>' : '') + '</td>';
        html += '<td>' + formatCurrency(item.budget) + '</td>';
        html += '<td>' + formatCurrency(item.actual) + '</td>';
        html += '<td class="' + itemVarianceClass + '">' + formatCurrency(item.variance) + '</td>';
        html += '<td>' + itemStatusBadge + '</td></tr>';
      });

      const totalVarianceClass = cat.totalVariance < 0 ? 'variance-over' : 'variance-under';
      html += '<tr class="budget-row-total ' + (isOpen ? 'expanded' : '') + '" data-budget-cat-child="' + catIndex + '">';
      html += '<td style="padding-left:40px;font-weight:600;">TOTAL</td>';
      html += '<td>' + formatCurrency(cat.totalBudget) + '</td>';
      html += '<td>' + formatCurrency(cat.totalActual) + '</td>';
      html += '<td class="' + totalVarianceClass + '">' + formatCurrency(cat.totalVariance) + '</td>';
      html += '<td></td></tr>';

      grandBudget += cat.budget;
      grandActual += cat.actual;
      grandVariance += cat.variance;
    });

    const grandVarianceClass = grandVariance < 0 ? 'variance-over' : 'variance-under';
    html += '<tr class="budget-row-grand"><td>TOTALS</td>';
    html += '<td>' + formatCurrency(grandBudget) + '</td>';
    html += '<td>' + formatCurrency(grandActual) + '</td>';
    html += '<td class="' + grandVarianceClass + '">' + formatCurrency(grandVariance) + '</td>';
    html += '<td></td></tr>';
    html += '</tbody></table></div>';
    html += '</div>'; // .finances-content-card-body--table
    html += '</div>'; // .finances-content-card

    return html;
  }

  function renderAdminUpdatesTab(project) {
    return renderUpdatesTab(project, 'admin');
  }

  // ========================================
  // PHOTOS TAB RENDERERS
  // ========================================

  function renderAdminPhotosTab(project) {
    var phases = project.phases || [];
    var html = '<div class="budget-page-header"><h2 class="budget-page-title">Photos</h2><p class="budget-page-subtitle">' + escapeHtml(project.name) + '</p></div>';
    html += '<div class="admin-section">';
    html += '<div class="photo-upload-area"><h4>Upload Photo</h4>';
    html += '<form id="photoUploadForm">';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group"><label>Photo File</label>';
    html += '<div class="styled-file-upload"><div class="styled-file-upload-label"><strong>Choose a photo</strong> or drag it here</div><input type="file" name="photoFile" accept="image/*" required></div></div>';
    html += '<div class="admin-form-group"><label>Caption</label>';
    html += '<input class="admin-input" type="text" name="caption" placeholder="Describe the photo"></div>';
    html += '</div>';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group"><label>Phase</label>';
    html += '<select class="admin-select" name="phase"><option value="">— No Phase —</option>';
    phases.forEach(function(p, i) {
      html += '<option value="' + escapeAttr(p.name) + '">' + escapeHtml(p.name) + '</option>';
    });
    html += '</select></div></div>';
    html += '<div class="btn-group"><button type="submit" class="btn btn-primary btn-small" id="photoUploadBtn">Upload Photo</button></div>';
    html += '</form></div>';

    if (photosLoading) {
      html += '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading photos...</span></div>';
    } else if (projectPhotos.length === 0) {
      html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Photos Yet</div><div class="finances-invoices-empty-msg">Upload photos from the field to share progress with your client.</div></div>';
    } else {
      html += renderPhotoGrid(true);
    }
    html += '</div>';
    return html;
  }

  function renderClientPhotosTab(project) {
    var html = '<div class="finances-page-header"><div class="finances-page-title">PHOTOS</div><div class="finances-page-subtitle">' + escapeHtml(project.name) + '</div></div>';
    html += '<div class="admin-section">';
    if (photosLoading) {
      html += '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading photos...</span></div>';
    } else if (projectPhotos.length === 0) {
      html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Photos Yet</div><div class="finances-invoices-empty-msg">Your builder will share project photos here as work progresses.</div></div>';
    } else {
      // Phase filter bar
      var phaseSet = {};
      projectPhotos.forEach(function(p) { if (p.phase) phaseSet[p.phase] = true; });
      var phaseNames = Object.keys(phaseSet).sort();
      if (phaseNames.length > 0) {
        html += '<div class="photo-filter-bar">';
        html += '<button class="photo-filter-btn ' + (photoFilterPhase === 'all' ? 'active' : '') + '" data-photo-filter="all">All</button>';
        phaseNames.forEach(function(pn) {
          html += '<button class="photo-filter-btn ' + (photoFilterPhase === pn ? 'active' : '') + '" data-photo-filter="' + escapeAttr(pn) + '">' + escapeHtml(pn) + '</button>';
        });
        html += '</div>';
      }
      html += renderPhotoGrid(false);
    }
    html += '</div>';
    return html;
  }

  function renderPhotoGrid(isAdmin) {
    var filtered = projectPhotos;
    if (photoFilterPhase !== 'all') {
      filtered = projectPhotos.filter(function(p) { return p.phase === photoFilterPhase; });
    }
    var html = '<div class="photo-grid">';
    filtered.forEach(function(photo) {
      html += '<div class="photo-card" data-photo-lightbox="' + escapeAttr(photo.url) + '" data-photo-caption="' + escapeAttr(photo.caption || photo.filename) + '">';
      if (isAdmin) {
        html += '<button class="photo-delete-btn" data-delete-photo="' + photo.id + '" title="Delete photo">&times;</button>';
      }
      html += '<img src="' + escapeAttr(photo.url) + '" alt="' + escapeAttr(photo.caption || photo.filename) + '" loading="lazy">';
      html += '<div class="photo-card-info">';
      html += '<div class="photo-card-caption">' + escapeHtml(photo.caption || photo.filename) + '</div>';
      html += '<div class="photo-card-meta">' + (photo.phase ? escapeHtml(photo.phase) + ' &middot; ' : '') + formatTimestampShort(photo.uploadedAt) + '</div>';
      html += '</div></div>';
    });
    html += '</div>';
    return html;
  }

  // ========================================
  // DOCUMENTS TAB RENDERERS
  // ========================================

  var DOC_CATEGORIES = ['Plans', 'Permits', 'Contracts', 'Change Orders', 'Insurance', 'Other'];

  function renderAdminDocumentsTab(project) {
    var html = '<div class="budget-page-header"><h2 class="budget-page-title">Documents</h2><p class="budget-page-subtitle">' + escapeHtml(project.name) + '</p></div>';
    html += '<div class="admin-section">';
    html += '<div class="doc-upload-area"><h4>Upload Document</h4>';
    html += '<form id="docUploadForm">';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group"><label>File</label>';
    html += '<div class="styled-file-upload"><div class="styled-file-upload-label"><strong>Choose a file</strong> or drag it here</div><input type="file" name="docFile" required></div></div>';
    html += '<div class="admin-form-group"><label>Category</label>';
    html += '<select class="admin-select" name="category">';
    DOC_CATEGORIES.forEach(function(c) { html += '<option value="' + c + '">' + c + '</option>'; });
    html += '</select></div></div>';
    html += '<div class="btn-group"><button type="submit" class="btn btn-primary btn-small" id="docUploadBtn">Upload Document</button></div>';
    html += '</form></div>';

    if (documentsLoading) {
      html += '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading documents...</span></div>';
    } else if (projectDocuments.length === 0) {
      html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Documents Yet</div><div class="finances-invoices-empty-msg">Upload plans, permits, and contracts using the form above.</div></div>';
    } else {
      html += renderDocumentList(true);
    }
    html += '</div>';
    return html;
  }

  function renderClientDocumentsTab(project) {
    var html = '<div class="finances-page-header"><div class="finances-page-title">DOCUMENTS</div><div class="finances-page-subtitle">' + escapeHtml(project.name) + '</div></div>';
    if (documentsLoading) {
      html += '<div class="finances-content-card"><div class="finances-content-card-body"><div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading documents…</span></div></div></div>';
    } else if (projectDocuments.length === 0) {
      html += '<div class="finances-content-card"><div class="finances-content-card-body">';
      html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Documents Yet</div><div class="finances-invoices-empty-msg">Plans, permits, contracts, and other project documents will be shared here as your project progresses.</div></div>';
      html += '</div></div>';
    } else {
      html += renderDocumentList(false);
    }
    return html;
  }

  function renderDocumentList(isAdmin) {
    var grouped = {};
    DOC_CATEGORIES.forEach(function(c) { grouped[c] = []; });
    projectDocuments.forEach(function(doc) {
      var cat = doc.category || 'Other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(doc);
    });

    var html = '';
    // Build ordered list of all categories (standard + custom)
    var allCats = DOC_CATEGORIES.concat(Object.keys(grouped).filter(function(c) { return DOC_CATEGORIES.indexOf(c) < 0; }));
    allCats.forEach(function(catName) {
      var docs = grouped[catName];
      if (!docs || docs.length === 0) return;
      html += '<div class="finances-content-card" style="margin-bottom:16px;">';
      html += '<div class="finances-content-card-header finances-content-card-header--warm">';
      html += '<div class="finances-content-card-title">' + escapeHtml(catName) + '</div>';
      html += '<div class="finances-content-card-desc">' + docs.length + ' document' + (docs.length !== 1 ? 's' : '') + '</div>';
      html += '</div>';
      html += '<div class="finances-content-card-body" style="padding:0;">';
      docs.forEach(function(doc) {
        html += '<div class="doc-list-item">';
        html += getDocIcon(doc.type);
        html += '<div class="doc-info">';
        html += '<div class="doc-name">' + escapeHtml(doc.filename) + '</div>';
        html += '<div class="doc-meta">' + formatTimestampShort(doc.uploadedAt) + '</div>';
        html += '</div>';
        html += '<div class="doc-actions">';
        if (isPreviewable(doc.type)) {
          html += '<button class="doc-download-btn" onclick="openDocPreview(\'' + escapeAttr(doc.url) + '\', \'' + escapeAttr(doc.filename) + '\', \'' + doc.type + '\')">Preview</button>';
        } else {
          html += '<a href="' + escapeAttr(doc.url) + '" target="_blank" class="doc-download-btn">Download</a>';
        }
        if (isAdmin) {
          html += '<button class="doc-delete-btn" data-delete-doc="' + doc.id + '">Delete</button>';
        }
        html += '</div></div>';
      });
      html += '</div>'; // card body
      html += '</div>'; // card
    });

    return html;
  }

  // ========================================
  // SELECTIONS TAB RENDERERS
  // ========================================

  var SELECTION_CATEGORIES = ['Kitchen', 'Bathroom', 'Flooring', 'Lighting', 'Exterior', 'Other'];
  var SELECTION_STATUSES = ['Pending', 'Approved', 'Ordered', 'Installed'];

  function renderAdminSelectionsTab(project) {
    var html = '<div class="budget-page-header"><h2 class="budget-page-title">Selections</h2><p class="budget-page-subtitle">' + escapeHtml(project.name) + '</p></div>';
    html += '<div class="admin-section">';
    html += '<div class="selection-add-area"><h4>Add Selection</h4>';
    html += '<form id="selectionAddForm">';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group"><label>Name *</label>';
    html += '<input class="admin-input" type="text" name="selName" placeholder="e.g. Quartz Countertop" required></div>';
    html += '<div class="admin-form-group"><label>Category</label>';
    html += '<select class="admin-select" name="selCategory">';
    SELECTION_CATEGORIES.forEach(function(c) { html += '<option value="' + c + '">' + c + '</option>'; });
    html += '</select></div></div>';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group"><label>Status</label>';
    html += '<select class="admin-select" name="selStatus">';
    SELECTION_STATUSES.forEach(function(s) { html += '<option value="' + s + '">' + s + '</option>'; });
    html += '</select></div>';
    html += '<div class="admin-form-group"><label>Cost</label>';
    html += '<input class="admin-input" type="number" name="selCost" step="0.01" min="0" placeholder="0.00"></div>';
    html += '</div>';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group"><label>Image (optional)</label>';
    html += '<div class="styled-file-upload"><div class="styled-file-upload-label"><strong>Choose an image</strong> or drag it here</div><input type="file" name="selImage" accept="image/*"></div></div>';
    html += '<div class="admin-form-group"><label>Notes</label>';
    html += '<input class="admin-input" type="text" name="selNotes" placeholder="Optional notes"></div>';
    html += '</div>';
    html += '<div class="btn-group"><button type="submit" class="btn btn-primary btn-small" id="selectionAddBtn">Add Selection</button></div>';
    html += '</form></div>';

    if (selectionsLoading) {
      html += '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading selections...</span></div>';
    } else if (projectSelections.length === 0) {
      html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Selections Yet</div><div class="finances-invoices-empty-msg">Add material and finish selections using the form above.</div></div>';
    } else {
      html += renderSelectionsGrouped(true);
    }
    html += '</div>';
    return html;
  }

  function renderClientSelectionsTab(project) {
    var html = '<div class="finances-page-header"><div class="finances-page-title">SELECTIONS</div><div class="finances-page-subtitle">' + escapeHtml(project.name) + '</div></div>';
    if (selectionsLoading) {
      html += '<div class="finances-content-card"><div class="finances-content-card-body"><div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading selections…</span></div></div></div>';
    } else if (projectSelections.length === 0) {
      html += '<div class="finances-content-card"><div class="finances-content-card-body">';
      html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Selections Yet</div><div class="finances-invoices-empty-msg">Your finishes and material selections will appear here for your review and approval.</div></div>';
      html += '</div></div>';
    } else {
      html += renderSelectionsGrouped(false);
    }
    return html;
  }

  function renderSelectionsGrouped(isAdmin) {
    var grouped = {};
    projectSelections.forEach(function(sel) {
      var cat = sel.category || 'Other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(sel);
    });

    var html = '';
    var catOrder = SELECTION_CATEGORIES.concat(Object.keys(grouped).filter(function(c) { return SELECTION_CATEGORIES.indexOf(c) < 0; }));
    var seen = {};
    catOrder.forEach(function(catName) {
      if (seen[catName]) return;
      seen[catName] = true;
      var items = grouped[catName];
      if (!items || items.length === 0) return;

      html += '<div class="finances-content-card" style="margin-bottom:16px;">';
      html += '<div class="finances-content-card-header finances-content-card-header--warm">';
      html += '<div class="finances-content-card-title">' + escapeHtml(catName) + '</div>';
      html += '<div class="finances-content-card-desc">' + items.length + ' item' + (items.length !== 1 ? 's' : '') + '</div>';
      html += '</div>';
      html += '<div class="finances-content-card-body" style="padding:0;">';

      items.forEach(function(sel) {
        var statusClass = (sel.status || 'Pending').toLowerCase();
        html += '<div class="selection-card">';
        if (sel.imageUrl) {
          html += '<img class="selection-image" src="' + escapeAttr(sel.imageUrl) + '" alt="' + escapeAttr(sel.name) + '" data-photo-lightbox="' + escapeAttr(sel.imageUrl) + '" data-photo-caption="' + escapeAttr(sel.name) + '">';
        } else {
          html += '<div class="selection-image-placeholder">No Image</div>';
        }
        html += '<div class="selection-details">';
        html += '<div class="selection-name">' + escapeHtml(sel.name) + '</div>';
        if (sel.notes) html += '<div class="selection-notes">' + escapeHtml(sel.notes) + '</div>';
        html += '<div class="selection-meta-row">';
        html += '<span class="selection-status ' + statusClass + '">' + escapeHtml(sel.status || 'Pending') + '</span>';
        if (sel.cost) html += '<span class="selection-cost">' + formatCurrency(sel.cost) + '</span>';
        html += '</div></div>';

        if (isAdmin) {
          html += '<div class="selection-admin-actions">';
          html += '<select class="selection-status-select" data-sel-status="' + sel.id + '">';
          SELECTION_STATUSES.forEach(function(s) {
            html += '<option value="' + s + '" ' + (sel.status === s ? 'selected' : '') + '>' + s + '</option>';
          });
          html += '</select>';
          html += '<button class="selection-delete-btn" data-delete-sel="' + sel.id + '">Delete</button>';
          html += '</div>';
        } else if ((sel.status || 'Pending') === 'Pending') {
          // Client view: show Approve button for pending selections
          html += '<div style="padding:8px 12px 12px;">';
          html += '<button class="co-approve-btn" data-sel-approve="' + sel.id + '" data-sel-name="' + escapeAttr(sel.name || 'Selection') + '" style="font-size:11px;padding:8px 18px;">Approve</button>';
          html += '</div>';
        }
        if (!isAdmin && sel.signature) {
          html += '<div style="padding:4px 12px 12px;">';
          html += '<div style="font-family:var(--font-nav);font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-tertiary);margin-bottom:4px;">Client Signature</div>';
          html += '<img src="' + sel.signature + '" alt="Signature" style="height:50px;border-bottom:1px solid var(--border);">';
          html += '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);margin-top:2px;">' + escapeHtml(sel.signedBy || '') + (sel.signedBy && sel.approvedAt ? ' — ' : '') + formatTimestampShort(sel.approvedAt) + '</div>';
          html += '</div>';
        }
        if (isAdmin && sel.signature) {
          html += '<div style="padding:4px 12px 12px;">';
          html += '<div style="font-family:var(--font-nav);font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-tertiary);margin-bottom:4px;">Client Signature</div>';
          html += '<img src="' + sel.signature + '" alt="Signature" style="height:50px;border-bottom:1px solid var(--border);">';
          html += '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);margin-top:2px;">' + escapeHtml(sel.signedBy || '') + (sel.signedBy && sel.approvedAt ? ' — ' : '') + formatTimestampShort(sel.approvedAt) + '</div>';
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div>'; // card body
      html += '</div>'; // card
    });
    return html;
  }

  // ========================================
  // CHANGE ORDERS RENDERERS
  // ========================================

  function renderCostImpactBadge(amount) {
    var num = Number(amount) || 0;
    var cls = num < 0 ? 'co-cost-negative' : 'co-cost-positive';
    return '<span class="' + cls + '">' + escapeHtml(formatCostImpact(num)) + '</span>';
  }

  function renderCoStatusBadge(status) {
    var cls = status === 'approved' ? 'co-status-approved' : (status === 'denied' ? 'co-status-denied' : 'co-status-pending');
    var label = status === 'approved' ? 'Approved' : (status === 'denied' ? 'Denied' : 'Pending');
    return '<span class="' + cls + '">' + label + '</span>';
  }

  function renderChangeOrdersSummaryBar(project, showPdfBtn) {
    var summary = getChangeOrdersSummary();
    var approvedClass = summary.approvedImpact < 0 ? 'co-cost-negative' : (summary.approvedImpact > 0 ? 'co-cost-positive' : '');
    var approvedStr = formatCostImpact(summary.approvedImpact);
    var html = '<div class="co-summary-bar">';
    html += '<div class="co-summary-item"><span class="co-summary-label">Total Change Orders</span><span class="co-summary-value">' + summary.total + '</span></div>';
    html += '<div class="co-summary-item"><span class="co-summary-label">Approved Impact</span><span class="co-summary-value ' + approvedClass + '">' + escapeHtml(approvedStr) + '</span></div>';
    if (showPdfBtn && summary.total > 0) {
      html += '<div style="margin-left:auto"><button class="btn btn-secondary btn-small" id="downloadCoPdfBtn">↓ Download PDF</button></div>';
    }
    html += '</div>';
    return html;
  }

  function renderAdminChangeOrdersTab(project) {
    var html = '<div class="budget-page-header"><h2 class="budget-page-title">Change Orders</h2><p class="budget-page-subtitle">' + escapeHtml(project.name) + '</p></div>';
    html += '<div class="admin-section">';

    // Add form
    html += '<div class="add-update-form"><h4>Add Change Order</h4>';
    html += '<form id="addChangeOrderForm">';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group"><label>Title *</label>';
    html += '<input class="admin-input" type="text" name="coTitle" placeholder="e.g. Upgrade to quartz countertops" required></div>';
    html += '<div class="admin-form-group"><label>Cost Impact ($)</label>';
    html += '<input class="admin-input" type="number" name="coCostImpact" step="0.01" placeholder="e.g. 4500 or -1200" value="0"></div>';
    html += '</div>';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group admin-form-full"><label>Description</label>';
    html += '<textarea class="admin-input admin-textarea" name="coDescription" placeholder="Detailed explanation of the change..."></textarea></div>';
    html += '</div>';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group"><label>Requested By</label>';
    html += '<select class="admin-select" name="coRequestedBy">';
    html += '<option value="builder">Builder</option>';
    html += '<option value="client">Client</option>';
    html += '</select></div>';
    html += '</div>';
    html += '<div class="btn-group"><button type="submit" class="btn btn-primary btn-small" id="addChangeOrderBtn">Add Change Order</button></div>';
    html += '</form></div>';

    if (changeOrdersLoading) {
      html += '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading change orders...</span></div>';
      html += '</div>';
      return html;
    }

    html += renderChangeOrdersSummaryBar(project, true);

    if (currentChangeOrders.length === 0) {
      html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Change Orders</div><div class="finances-invoices-empty-msg">Change orders will appear here once you create one above.</div></div>';
    } else {
      currentChangeOrders.forEach(function(co) {
        var costNum = Number(co.costImpact) || 0;
        html += '<div class="co-card">';
        html += '<div class="co-card-header">';
        html += '<div class="co-card-title">' + escapeHtml(co.title || '') + '</div>';
        html += '<div style="display:flex;align-items:center;gap:8px;">';
        html += renderCostImpactBadge(costNum);
        html += renderCoStatusBadge(co.status || 'pending');
        html += '</div>';
        html += '</div>';
        html += '<div class="co-card-meta">';
        html += '<span style="font-family:var(--font-nav);font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-tertiary)">Requested by: ' + escapeHtml((co.requestedBy || 'builder').charAt(0).toUpperCase() + (co.requestedBy || 'builder').slice(1)) + '</span>';
        html += '<span style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary)">Created: ' + formatTimestamp(co.createdAt) + '</span>';
        if (co.respondedAt) html += '<span style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary)">Responded: ' + formatTimestamp(co.respondedAt) + '</span>';
        html += '</div>';
        if (co.description) html += '<div class="co-card-desc">' + escapeHtml(co.description) + '</div>';
        if (co.responseNote) {
          html += '<div class="co-response-area"><span style="font-family:var(--font-nav);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary)">Client Response:</span>';
          html += '<div class="co-response-note">' + escapeHtml(co.responseNote) + '</div></div>';
        }
        if (co.signature) {
          html += '<div style="margin-top:8px;">';
          html += '<div style="font-family:var(--font-nav);font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-tertiary);margin-bottom:4px;">Client Signature</div>';
          html += '<img src="' + co.signature + '" alt="Signature" style="height:50px;border-bottom:1px solid var(--border);">';
          html += '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);margin-top:2px;">' + escapeHtml(co.signedBy || '') + (co.signedBy && co.signedAt ? ' — ' : '') + formatTimestampShort(co.signedAt) + '</div>';
          html += '</div>';
        }
        html += '<div class="co-card-footer">';
        html += '<button class="btn btn-danger btn-small" data-delete-co="' + co.id + '">Delete</button>';
        html += '</div>';
        html += '</div>';
      });
    }

    html += '</div>';
    return html;
  }

  function renderClientChangeOrders(project) {
    var pageHdr = '<div class="finances-page-header"><div class="finances-page-title">APPROVALS</div><div class="finances-page-subtitle">' + escapeHtml(project.name) + '</div></div>';

    if (changeOrdersLoading) {
      return pageHdr + '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading change orders…</span></div>';
    }

    var html = pageHdr;

    // Summary card
    var coTotal = currentChangeOrders.length;
    var coPending = currentChangeOrders.filter(function(co) { return co.status === 'pending'; }).length;
    html += '<div class="finances-content-card" style="margin-bottom:20px;">';
    html += '<div class="finances-content-card-header finances-content-card-header--warm">';
    html += '<div class="finances-content-card-title">Change Orders</div>';
    if (coTotal > 0) {
      html += '<div class="finances-content-card-desc">' + coTotal + ' total' + (coPending > 0 ? ' · ' + coPending + ' pending your approval' : '') + '</div>';
    }
    html += '</div>';
    html += '<div class="finances-content-card-body">';
    html += renderChangeOrdersSummaryBar(project, true);
    html += '</div></div>';

    if (currentChangeOrders.length === 0) {
      html += '<div class="finances-content-card"><div class="finances-content-card-body">';
      html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Change Orders</div><div class="finances-invoices-empty-msg">Change orders will appear here if the scope or cost of your project changes. Your builder will notify you.</div></div>';
      html += '</div></div>';
      return html;
    }

    currentChangeOrders.forEach(function(co) {
      var costNum = Number(co.costImpact) || 0;
      var isPending = co.status === 'pending';
      html += '<div class="co-card">';
      html += '<div class="co-card-header">';
      html += '<div class="co-card-title">' + escapeHtml(co.title || '') + '</div>';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += renderCostImpactBadge(costNum);
      html += renderCoStatusBadge(co.status || 'pending');
      html += '</div>';
      html += '</div>';
      html += '<div class="co-card-meta">';
      html += '<span style="font-family:var(--font-nav);font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-tertiary)">Requested by: ' + escapeHtml((co.requestedBy || 'builder').charAt(0).toUpperCase() + (co.requestedBy || 'builder').slice(1)) + '</span>';
      html += '<span style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary)">Created: ' + formatTimestamp(co.createdAt) + '</span>';
      if (co.respondedAt) html += '<span style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary)">Responded: ' + formatTimestamp(co.respondedAt) + '</span>';
      html += '</div>';
      if (co.description) html += '<div class="co-card-desc">' + escapeHtml(co.description) + '</div>';

      if (isPending) {
        html += '<div class="co-response-area">';
        html += '<div style="font-family:var(--font-nav);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary);margin-bottom:10px">Your Response</div>';
        html += '<textarea class="admin-input admin-textarea" id="coNote_' + co.id + '" placeholder="Optional note (visible to builder)..." style="min-height:60px;margin-bottom:10px"></textarea>';
        html += '<div style="display:flex;gap:10px;">';
        html += '<button class="co-approve-btn" data-co-approve="' + co.id + '">Approve</button>';
        html += '<button class="co-deny-btn" data-co-deny="' + co.id + '">Deny</button>';
        html += '</div>';
        html += '</div>';
      } else if (co.responseNote) {
        html += '<div class="co-response-area"><span style="font-family:var(--font-nav);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary)">Your Response:</span>';
        html += '<div class="co-response-note">' + escapeHtml(co.responseNote) + '</div></div>';
      }
      if (co.signature) {
        html += '<div style="margin-top:8px;">';
        html += '<div style="font-family:var(--font-nav);font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-tertiary);margin-bottom:4px;">Client Signature</div>';
        html += '<img src="' + co.signature + '" alt="Signature" style="height:50px;border-bottom:1px solid var(--border);">';
        html += '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);margin-top:2px;">' + escapeHtml(co.signedBy || '') + (co.signedBy && co.signedAt ? ' — ' : '') + formatTimestampShort(co.signedAt) + '</div>';
        html += '</div>';
      }

      // Download button on every non-pending CO
      if (!isPending) {
        html += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">';
        html += '<button class="btn btn-secondary btn-small co-download-btn" data-co-download="' + co.id + '">↓ Download PDF</button>';
        html += '</div>';
      }

      html += '</div>';
    });

    return html;
  }

  function renderEmployeeChangeOrdersTab(project) {
    if (changeOrdersLoading) {
      return '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading change orders...</span></div>';
    }

    var html = '<div class="admin-section">';
    html += renderChangeOrdersSummaryBar(project, false);

    if (currentChangeOrders.length === 0) {
      html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Change Orders</div><div class="finances-invoices-empty-msg">No change orders have been added to this project yet.</div></div>';
    } else {
      currentChangeOrders.forEach(function(co) {
        var costNum = Number(co.costImpact) || 0;
        html += '<div class="co-card">';
        html += '<div class="co-card-header">';
        html += '<div class="co-card-title">' + escapeHtml(co.title || '') + '</div>';
        html += '<div style="display:flex;align-items:center;gap:8px;">';
        html += renderCostImpactBadge(costNum);
        html += renderCoStatusBadge(co.status || 'pending');
        html += '</div>';
        html += '</div>';
        html += '<div class="co-card-meta">';
        html += '<span style="font-family:var(--font-nav);font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-tertiary)">Requested by: ' + escapeHtml((co.requestedBy || 'builder').charAt(0).toUpperCase() + (co.requestedBy || 'builder').slice(1)) + '</span>';
        html += '<span style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary)">Created: ' + formatTimestamp(co.createdAt) + '</span>';
        if (co.respondedAt) html += '<span style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary)">Responded: ' + formatTimestamp(co.respondedAt) + '</span>';
        html += '</div>';
        if (co.description) html += '<div class="co-card-desc">' + escapeHtml(co.description) + '</div>';
        if (co.responseNote) {
          html += '<div class="co-response-area"><span style="font-family:var(--font-nav);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary)">Client Response:</span>';
          html += '<div class="co-response-note">' + escapeHtml(co.responseNote) + '</div></div>';
        }
        if (co.signature) {
          html += '<div style="margin-top:8px;">';
          html += '<div style="font-family:var(--font-nav);font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-tertiary);margin-bottom:4px;">Client Signature</div>';
          html += '<img src="' + co.signature + '" alt="Signature" style="height:50px;border-bottom:1px solid var(--border);">';
          html += '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);margin-top:2px;">' + escapeHtml(co.signedBy || '') + (co.signedBy && co.signedAt ? ' — ' : '') + formatTimestampShort(co.signedAt) + '</div>';
          html += '</div>';
        }
        html += '</div>';
      });
    }

    html += '</div>';
    return html;
  }

  // ========================================
  // INVOICES RENDER
  // ========================================

  function renderAdminInvoicesTab(project) {
    var html = '<div class="budget-page-header"><h2 class="budget-page-title">Invoices</h2><p class="budget-page-subtitle">' + escapeHtml(project.name) + '</p></div>';
    html += '<div class="admin-section">';

    // ── QBO SYNC BANNER (connect/disconnect moved to Settings) ──
    if (qboConnected) {
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:6px;margin-bottom:16px;">';
      html += '<span style="font-family:var(--font-nav);font-size:11px;font-weight:600;color:#1a7a1a;text-transform:uppercase;letter-spacing:0.08em;">&#10003; QuickBooks Connected</span>';
      html += '<button class="btn btn-primary btn-small" id="syncQboBtn">Sync from QuickBooks</button>';
      html += '</div>';
    } else {
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:6px;margin-bottom:16px;">';
      html += '<span style="font-family:var(--font-nav);font-size:11px;color:var(--text-tertiary);">QuickBooks not connected. <a href="#" id="goToSettingsQbo" style="color:var(--accent-warm);">Go to Settings</a> to connect.</span>';
      html += '</div>';
    }

    // ── MANUAL INVOICE FORM (always shown as fallback) ───────
    html += '<div class="add-update-form"><h4>Add Invoice Manually</h4>';
    html += '<form id="addInvoiceForm">';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group"><label>Title *</label>';
    html += '<input class="admin-input" type="text" name="invTitle" placeholder="e.g. Draw #1 - Foundation" required></div>';
    html += '<div class="admin-form-group"><label>Amount ($) *</label>';
    html += '<input class="admin-input" type="number" name="invAmount" step="0.01" min="0" placeholder="e.g. 15000" required></div>';
    html += '</div>';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group"><label>Status</label>';
    html += '<select class="admin-select" name="invStatus">';
    html += '<option value="pending">Pending</option>';
    html += '<option value="sent">Sent</option>';
    html += '<option value="paid">Paid</option>';
    html += '<option value="overdue">Overdue</option>';
    html += '</select></div>';
    html += '<div class="admin-form-group"><label>Due Date</label>';
    html += '<input class="admin-input" type="date" name="invDueDate"></div>';
    html += '</div>';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group admin-form-full"><label>Invoice URL (QuickBooks or payment link)</label>';
    html += '<input class="admin-input" type="url" name="invUrl" placeholder="https://..." autocomplete="off"></div>';
    html += '</div>';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group admin-form-full"><label>Notes (optional)</label>';
    html += '<textarea class="admin-input admin-textarea" name="invNotes" placeholder="Any notes for the client..."></textarea></div>';
    html += '</div>';
    html += '<div class="btn-group"><button type="submit" class="btn btn-primary btn-small" id="addInvoiceBtn">Add Invoice</button></div>';
    html += '</form></div>';

    if (invoicesLoading) {
      html += '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading invoices...</span></div>';
      html += '</div>';
      return html;
    }

    html += renderInvoicesSummaryBar();

    if (currentInvoices.length === 0) {
      if (qboConnected) {
        html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Invoices Synced</div><div class="finances-invoices-empty-msg">Click \\&lsquo;Sync from QuickBooks\\&rsquo; above to pull in your latest invoices.</div></div>';
      } else {
        html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Invoices Yet</div><div class="finances-invoices-empty-msg">Add an invoice above or connect QuickBooks to sync automatically.</div></div>';
      }
    } else {
      currentInvoices.forEach(function(inv) {
        var isPaid = inv.status === 'paid';
        html += '<div class="invoice-item' + (isPaid ? ' is-paid' : '') + '">';
        html += '<div class="invoice-item-header">';
        html += '<div class="invoice-item-title">' + escapeHtml(inv.title || '') + '</div>';
        html += '<div style="display:flex;align-items:center;gap:8px;">';
        html += '<div class="invoice-amount">' + formatCurrency(inv.amount) + '</div>';
        html += renderInvoiceStatusBadge(inv.status);
        html += '</div>';
        html += '</div>';
        html += '<div class="invoice-item-meta">';
        if (inv.dueDate) html += '<span style="font-family:var(--font-nav);font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-tertiary)">Due: ' + formatDate(inv.dueDate) + '</span>';
        if (inv.invoiceUrl) html += '<a href="' + escapeAttr(inv.invoiceUrl) + '" target="_blank" rel="noopener noreferrer" style="font-family:var(--font-nav);font-size:10px;color:var(--text-secondary);text-decoration:underline;">View Invoice &#8599;</a>';
        html += '</div>';
        if (inv.notes) html += '<div class="invoice-item-notes">' + escapeHtml(inv.notes) + '</div>';
        html += '<div class="invoice-item-footer">';
        if (!inv.fromQbo) {
          html += '<select class="admin-select" style="font-size:11px;padding:6px 10px;" data-invoice-status-id="' + inv.id + '">';
          html += '<option value="pending"' + (inv.status === 'pending' ? ' selected' : '') + '>Pending</option>';
          html += '<option value="sent"' + (inv.status === 'sent' ? ' selected' : '') + '>Sent</option>';
          html += '<option value="paid"' + (inv.status === 'paid' ? ' selected' : '') + '>Paid</option>';
          html += '<option value="overdue"' + (inv.status === 'overdue' ? ' selected' : '') + '>Overdue</option>';
          html += '</select>';
          html += '<button class="btn btn-danger btn-small" data-delete-invoice="' + inv.id + '">Delete</button>';
        } else {
          html += '<span style="font-family:var(--font-nav);font-size:10px;color:var(--text-tertiary);">Source: QuickBooks</span>';
        }
        html += '</div>';
        html += '</div>';
      });
    }

    html += '</div>';
    return html;
  }

  function renderClientInvoicesTab(project) {
    if (invoicesLoading) {
      return '<div class="finances-page-header"><div class="finances-page-title">INVOICES</div><div class="finances-page-subtitle">' + escapeHtml(project.name) + '</div></div><div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading invoices…</span></div>';
    }

    var html = '<div class="finances-page-header"><div class="finances-page-title">INVOICES</div><div class="finances-page-subtitle">' + escapeHtml(project.name) + '</div></div>';
    html += renderInvoicesSummaryBar();

    if (currentInvoices.length === 0) {
      html += '<div class="empty-state"><div class="empty-state-icon">PM</div><div class="empty-state-title">No Invoices Yet</div><div class="empty-state-message">Invoices will appear here when your builder adds them. You\'ll be able to review and pay directly from this page.</div></div>';
      return html;
    }

    currentInvoices.forEach(function(inv) {
      var isPaid = inv.status === 'paid';
      html += '<div class="invoice-item' + (isPaid ? ' is-paid' : '') + '">';
      html += '<div class="invoice-item-header">';
      html += '<div class="invoice-item-title">' + escapeHtml(inv.title || '') + '</div>';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += '<div class="invoice-amount">' + formatCurrency(inv.amount) + '</div>';
      html += renderInvoiceStatusBadge(inv.status);
      html += '</div>';
      html += '</div>';
      html += '<div class="invoice-item-meta">';
      if (inv.dueDate) html += '<span style="font-family:var(--font-nav);font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-tertiary)">Due: ' + formatDate(inv.dueDate) + '</span>';
      html += '</div>';
      if (inv.notes) html += '<div class="invoice-item-notes">' + escapeHtml(inv.notes) + '</div>';
      if (inv.invoiceUrl) {
        html += '<div class="invoice-item-footer">';
        if (!isPaid) {
          html += '<a href="' + escapeAttr(inv.invoiceUrl) + '" target="_blank" rel="noopener noreferrer" class="invoice-pay-btn">Pay Now</a>';
        } else {
          html += '<a href="' + escapeAttr(inv.invoiceUrl) + '" target="_blank" rel="noopener noreferrer" class="invoice-view-btn">View Invoice</a>';
        }
        html += '</div>';
      }
      html += '</div>';
    });

    return html;
  }

  function renderEmployeeInvoicesTab(project) {
    if (invoicesLoading) {
      return '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading invoices...</span></div>';
    }

    var html = '<div class="admin-section">';
    html += renderInvoicesSummaryBar();

    if (currentInvoices.length === 0) {
      html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Invoices</div><div class="finances-invoices-empty-msg">No invoices have been added to this project yet.</div></div>';
    } else {
      currentInvoices.forEach(function(inv) {
        var isPaid = inv.status === 'paid';
        html += '<div class="invoice-item' + (isPaid ? ' is-paid' : '') + '">';
        html += '<div class="invoice-item-header">';
        html += '<div class="invoice-item-title">' + escapeHtml(inv.title || '') + '</div>';
        html += '<div style="display:flex;align-items:center;gap:8px;">';
        html += '<div class="invoice-amount">' + formatCurrency(inv.amount) + '</div>';
        html += renderInvoiceStatusBadge(inv.status);
        html += '</div>';
        html += '</div>';
        html += '<div class="invoice-item-meta">';
        if (inv.dueDate) html += '<span style="font-family:var(--font-nav);font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-tertiary)">Due: ' + formatDate(inv.dueDate) + '</span>';
        if (inv.invoiceUrl) html += '<a href="' + escapeAttr(inv.invoiceUrl) + '" target="_blank" rel="noopener noreferrer" style="font-family:var(--font-nav);font-size:10px;color:var(--text-secondary);text-decoration:underline;">View Invoice ↗</a>';
        html += '</div>';
        if (inv.notes) html += '<div class="invoice-item-notes">' + escapeHtml(inv.notes) + '</div>';
        html += '</div>';
      });
    }

    html += '</div>';
    return html;
  }

  function bindAdminInvoiceEvents() {
    // Add invoice form
    document.getElementById('addInvoiceForm')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('addInvoiceBtn');
      btn.disabled = true;
      btn.textContent = 'Adding...';
      var fd = new FormData(this);
      var project = allProjects.find(function(p) { return p.id === adminSelectedProject; });
      try {
        await addInvoice(adminSelectedProject, {
          title: fd.get('invTitle'),
          amount: fd.get('invAmount'),
          status: fd.get('invStatus'),
          dueDate: fd.get('invDueDate'),
          invoiceUrl: fd.get('invUrl'),
          notes: fd.get('invNotes')
        });
        // Email notification to client
        if (project) {
          var client = allUsers.find(function(u) { return u.id === project.clientId; });
          if (client && client.email) {
            var invTitle = fd.get('invTitle');
            var invAmt = formatCurrency(Number(fd.get('invAmount')) || 0);
            var invDue = fd.get('invDueDate') ? formatDate(fd.get('invDueDate')) : 'TBD';
            var emailBody = '<p>A new invoice has been added to your project.</p>' +
              '<table style="border-collapse:collapse;margin:16px 0;">' +
              '<tr><td style="padding:4px 12px 4px 0;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Amount</td><td style="padding:4px 0;font-weight:600;">' + invAmt + '</td></tr>' +
              '<tr><td style="padding:4px 12px 4px 0;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.08em;">Due Date</td><td style="padding:4px 0;">' + escapeHtml(invDue) + '</td></tr>' +
              '</table>';
            sendEmailNotification(
              client.email,
              escapeHtml(project.name) + ' \u2014 New Invoice: ' + escapeHtml(invTitle),
              buildEmailHtml(project.name, 'New Invoice: ' + escapeHtml(invTitle), emailBody)
            );
          }
        }
        await loadInvoices(adminSelectedProject);
        showToast('Invoice added.');
      } catch (err) {
        showToast('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Add Invoice';
      }
    });

    // Status change dropdowns
    document.querySelectorAll('[data-invoice-status-id]').forEach(function(sel) {
      sel.addEventListener('change', async function() {
        var invId = sel.dataset.invoiceStatusId;
        var newStatus = sel.value;
        try {
          await updateInvoiceStatus(adminSelectedProject, invId, newStatus);
          await loadInvoices(adminSelectedProject);
        } catch (err) {
          showToast('Error updating status: ' + err.message);
        }
      });
    });

    // Delete buttons
    document.querySelectorAll('[data-delete-invoice]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (!confirm('Delete this invoice? This cannot be undone.')) return;
        var invId = btn.dataset.deleteInvoice;
        try {
          await deleteInvoice(adminSelectedProject, invId);
          await loadInvoices(adminSelectedProject);
          showToast('Invoice deleted.');
        } catch (err) {
          showToast('Error: ' + err.message);
        }
      });
    });

    // QBO: Sync from QuickBooks
    document.getElementById('syncQboBtn')?.addEventListener('click', async function() {
      var btn = document.getElementById('syncQboBtn');
      btn.disabled = true;
      btn.textContent = 'Syncing...';
      try {
        var result = await syncInvoicesFromQbo(adminSelectedProject);
        render();
        showToast('Synced ' + (result ? result.count : 0) + ' invoices from QuickBooks.');
      } catch (err) {
        showToast('QBO sync error: ' + (err.message || 'Unknown error'));
        btn.disabled = false;
        btn.textContent = 'Sync from QuickBooks';
      }
    });

    // QBO: Go to Settings link
    document.getElementById('goToSettingsQbo')?.addEventListener('click', function(e) {
      e.preventDefault();
      adminView = 'settings';
      adminSelectedProject = null;
      render();
    });

    // QBO: Connect
    document.getElementById('connectQboBtn')?.addEventListener('click', function() {
      var authUrl = getQboAuthUrl();
      if (authUrl) window.location.href = authUrl;
    });

    // QBO: Disconnect
    document.getElementById('disconnectQboBtn')?.addEventListener('click', async function() {
      if (!confirm('Disconnect QuickBooks? Invoice sync will stop for all projects.')) return;
      try {
        await disconnectQbo();
        showToast('QuickBooks disconnected.');
        render();
      } catch (err) {
        showToast('Error disconnecting: ' + (err.message || 'Unknown error'));
      }
    });
  }

  function bindClientInvoiceEvents() {
    // Pay Now buttons are <a> tags — no JS binding needed
  }

  // ========================================
  // VISUAL CLIENT TIMELINE
  // ========================================

  function renderVisualTimeline(project) {
    if (!project.phases || project.phases.length === 0) return '';
    var html = '<div class="visual-timeline">';
    html += '<div class="visual-timeline-title">Project Progress</div>';
    html += '<div class="visual-timeline-track">';
    project.phases.forEach(function(phase, i) {
      if (i > 0) html += '<div class="visual-timeline-connector"></div>';
      html += '<div class="visual-timeline-phase ' + phase.status + '">';
      html += '<div class="visual-timeline-bar"></div>';
      html += '<div class="visual-timeline-label">' + escapeHtml(phase.name || getPhaseDef(i + 1).name) + '</div>';
      html += '<div class="visual-timeline-marker">You Are Here</div>';
      html += '</div>';
    });
    html += '</div></div>';
    return html;
  }

  function renderBudgetItemModal() {
    const isEdit = editingBudgetItem != null;
    const item = editingBudgetItem || {};
    const title = isEdit ? 'Edit Budget Item' : 'Add Budget Item';
    const submitLabel = isEdit ? 'Save Changes' : 'Add Item';

    const categories = ['Structure', 'Site Work', 'Mechanical', 'Interior Finishes', 'Exterior', 'General Conditions'];
    const currentCat = item.category || '';
    const isCustomCat = currentCat && !categories.includes(currentCat);

    return `
      <div class="modal-overlay active" id="budgetModalOverlay">
        <div class="modal modal-budget">
          <h3>${title}</h3>
          <form id="budgetItemForm">
            <div class="admin-form-row">
              <div class="admin-form-group">
                <label>Cost Code *</label>
                <input class="admin-input" type="text" name="costCode" placeholder="e.g. Framing Labor" value="${escapeAttr(item.costCode || '')}" required>
              </div>
              <div class="admin-form-group">
                <label>Category</label>
                <select class="admin-select" name="categorySelect" id="budgetCatSelect">
                  <option value="">— Select —</option>
                  ${categories.map(c => '<option value="' + c + '" ' + (currentCat === c ? 'selected' : '') + '>' + c + '</option>').join('')}
                  <option value="__custom" ${isCustomCat ? 'selected' : ''}>Custom...</option>
                </select>
              </div>
            </div>
            <div class="admin-form-row" id="customCatRow" style="${isCustomCat ? '' : 'display:none'}">
              <div class="admin-form-group admin-form-full">
                <label>Custom Category</label>
                <input class="admin-input" type="text" name="customCategory" id="customCatInput" placeholder="e.g. Pool" value="${isCustomCat ? escapeAttr(currentCat) : ''}">
              </div>
            </div>
            <div class="admin-form-row">
              <div class="admin-form-group admin-form-full">
                <label>Vendor</label>
                <input class="admin-input" type="text" name="vendor" placeholder="e.g. Smith Construction" value="${escapeAttr(item.vendor || '')}">
              </div>
            </div>
            <div class="admin-form-row">
              <div class="admin-form-group">
                <label>Budget Amount *</label>
                <input class="admin-input" type="number" name="budgetAmount" step="0.01" min="0" placeholder="0.00" value="${item.budgetAmount || ''}" required>
              </div>
              <div class="admin-form-group">
                <label>Actual Amount</label>
                <input class="admin-input" type="number" name="actualAmount" step="0.01" min="0" placeholder="0.00" value="${item.actualAmount || 0}">
              </div>
            </div>
            <div class="admin-form-row">
              <div class="admin-form-group">
                <label>Status</label>
                <select class="admin-select" name="status">
                  <option value="pending" ${(item.status || 'pending') === 'pending' ? 'selected' : ''}>Pending</option>
                  <option value="in-progress" ${item.status === 'in-progress' ? 'selected' : ''}>In Progress</option>
                  <option value="complete" ${item.status === 'complete' ? 'selected' : ''}>Complete</option>
                </select>
              </div>
            </div>
            <div class="admin-form-row">
              <div class="admin-form-group admin-form-full">
                <label>Description / Notes</label>
                <textarea class="admin-input admin-textarea" name="notes" placeholder="Optional notes..." style="min-height:60px">${escapeHtml(item.notes || '')}</textarea>
              </div>
            </div>
            <div class="login-error" id="budgetModalError"></div>
            <div class="btn-group">
              <button type="submit" class="btn btn-primary btn-small" id="budgetModalSubmit">${submitLabel}</button>
              <button type="button" class="btn btn-secondary btn-small" id="budgetModalCancel">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function renderAdminSettings() {
    var html = '<div class="admin-overview">';
    html += '<div class="budget-page-header"><h2 class="budget-page-title">Settings</h2></div>';
    html += '<div class="admin-section">';
    html += '<h3 style="margin-bottom:12px;">QuickBooks Online</h3>';
    if (qboConnected) {
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:6px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;">';
      html += '<span style="font-family:var(--font-nav);font-size:11px;font-weight:600;color:#1a7a1a;text-transform:uppercase;letter-spacing:0.08em;">&#10003; QuickBooks Connected</span>';
      html += '</div>';
      html += '<button class="btn btn-secondary btn-small" id="disconnectQboBtn" style="color:#991B1B;">Disconnect</button>';
      html += '</div>';
      html += '<p style="font-size:12px;color:var(--text-tertiary);margin-top:8px;">To sync invoices, go to a project\'s Invoices tab and click "Sync from QuickBooks". To assign a QBO customer, go to the project\'s Details tab.</p>';
    } else {
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:6px;">';
      html += '<div>';
      html += '<div style="font-family:var(--font-nav);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary);">QuickBooks Not Connected</div>';
      html += '<div style="font-family:var(--font-nav);font-size:11px;color:var(--text-tertiary);margin-top:2px;">Connect your QuickBooks account to sync invoices across all projects.</div>';
      html += '</div>';
      html += '<button class="btn btn-primary btn-small" id="connectQboBtn">Connect QuickBooks</button>';
      html += '</div>';
    }
    html += '</div>';
    html += '</div>';
    return html;
  }

  function renderAdminClients() {
    const clients = allUsers.filter(u => u.role === 'client');
    let html = `
      <div class="budget-page-header"><h2 class="budget-page-title">Client Management</h2><p class="budget-page-subtitle">${clients.length} registered client${clients.length !== 1 ? 's' : ''}.</p></div>
      <div class="admin-section">
        <div class="admin-client-header">
          <h3 class="admin-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">All Clients</h3>
          <button class="btn btn-primary btn-small" id="addClientBtn">+ Add Client</button>
        </div>
        <table class="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Project</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
    `;

    clients.forEach(client => {
      const project = allProjects.find(p => p.clientId === client.id);
      html += `
        <tr>
          <td><strong>${escapeHtml(client.name)}</strong></td>
          <td>${escapeHtml(client.email)}</td>
          <td>${project ? escapeHtml(project.name) : '<span style="color:var(--text-tertiary)">Unassigned</span>'}</td>
          <td>${project ? '<span class="table-status status-in-progress">Active</span>' : '<span class="table-status status-upcoming">No Project</span>'}</td>
          <td style="text-align:right;white-space:nowrap;">
            <button class="btn btn-secondary btn-small" data-edit-client="${client.id}" style="font-size:9px;padding:4px 10px;margin-right:4px;">Edit</button>
            <button data-delete-client="${client.id}" data-delete-client-name="${escapeAttr(client.name)}" style="font-size:9px;padding:4px 10px;background:transparent;color:var(--text-tertiary);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-family:var(--font-nav);letter-spacing:0.08em;text-transform:uppercase;transition:all 0.15s;" onmouseover="this.style.borderColor='#e74c3c';this.style.color='#e74c3c'" onmouseout="this.style.borderColor='';this.style.color=''">Delete</button>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    return html;
  }

  // ========================================
  // ADMIN TEAM MANAGEMENT
  // ========================================

  function renderAdminTeam() {
    const employees = allUsers.filter(u => u.role === 'employee');
    let html = `
      <div class="budget-page-header"><h2 class="budget-page-title">Team</h2><p class="budget-page-subtitle">${employees.length} employee${employees.length !== 1 ? 's' : ''} on your team.</p></div>
      <div class="admin-section">
        <div class="admin-client-header">
          <h3 class="admin-section-title" style="margin-bottom:0;padding-bottom:0;border-bottom:none">All Employees</h3>
          <button class="btn btn-primary btn-small" id="addEmployeeBtn">+ Add Employee</button>
        </div>
        <table class="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Assigned Projects</th>
            </tr>
          </thead>
          <tbody>
    `;

    employees.forEach(emp => {
      const assigned = (emp.assignedProjects || []).map(pid => {
        const p = allProjects.find(proj => proj.id === pid);
        return p ? escapeHtml(p.name) : '(deleted)';
      });
      html += `
        <tr>
          <td><strong>${escapeHtml(emp.name)}</strong></td>
          <td>${escapeHtml(emp.email)}</td>
          <td>${assigned.length > 0 ? assigned.join(', ') : '<span style="color:var(--text-tertiary)">None</span>'}</td>
        </tr>
      `;
    });

    if (employees.length === 0) {
      html += '<tr><td colspan="3" style="text-align:center;color:var(--text-tertiary);padding:40px">No employees yet. Add one to get started.</td></tr>';
    }

    html += '</tbody></table></div>';
    return html;
  }

  // ========================================
  // EMPLOYEE PORTAL
  // ========================================

  function renderEmployeeLayout() {
    return `
      <nav class="nav-bar">
        <div class="nav-logo">${PORTAL_CONFIG.companyName}<span>Employee Portal</span></div>
        <div class="nav-links">
          <button class="nav-link" id="logoutBtn">Logout</button>
        </div>
      </nav>
      <main class="main-content">
        ${employeeView === 'overview' ? renderEmployeeOverview() : renderEmployeeDetail()}
      </main>
      <footer class="client-footer"><div class="client-footer-item" style="opacity:0.4;">Project Map — Powered by Dune</div></footer>
      ${lightboxPhoto ? '<div class="photo-lightbox" id="photoLightbox"><img src="' + escapeAttr(lightboxPhoto.url) + '" alt="' + escapeAttr(lightboxPhoto.caption) + '"><div class="photo-lightbox-caption">' + escapeHtml(lightboxPhoto.caption) + '</div></div>' : ''}
    `;
  }

  function renderEmployeeOverview() {
    let html = `
      <div class="budget-page-header"><h2 class="budget-page-title">Welcome, ${escapeHtml((userProfile.name || '').split(' ')[0])}</h2><p class="budget-page-subtitle">Your assigned projects.</p></div>
      <div class="admin-overview">
    `;

    if (allProjects.length === 0) {
      html += '<p style="color:var(--text-tertiary);font-family:var(--font-mono);font-size:13px">No projects assigned yet. Contact your administrator.</p>';
    } else {
      allProjects.forEach(project => {
        const cp = getCurrentPhase(project);
        const cpNum = cp ? (project.phases.indexOf(cp) + 1) : 1;
        const cpDef = getPhaseDef(cpNum);
        const progress = getProjectProgress(project);
        html += `
          <div class="admin-project-card" data-emp-project-id="${project.id}">
            <div class="admin-card-name">${escapeHtml(project.name)}</div>
            <div class="admin-card-location">${escapeHtml(project.location || '')}</div>
            <div class="admin-card-meta">
              <span class="admin-card-phase">Phase ${cpNum}: ${cpDef.name}</span>
              <div class="admin-card-progress">
                <div class="admin-card-progress-bar" style="width:${progress}%"></div>
              </div>
            </div>
            <span class="admin-card-link">→ View Project</span>
          </div>
        `;
      });
    }

    html += '</div>';
    return html;
  }

  function renderEmployeeDetail() {
    const project = allProjects.find(p => p.id === employeeSelectedProject);
    if (!project) return '<p>Project not found.</p>';

    let html = `
      <button class="admin-detail-back" id="empBackBtn">← Back to Projects</button>
      <div class="budget-page-header"><h2 class="budget-page-title">${escapeHtml(project.name)}</h2><p class="budget-page-subtitle">${escapeHtml(project.location || '')}</p></div>

      <div class="admin-detail-tabs">
        <button class="admin-detail-tab ${employeeDetailTab === 'phases' ? 'active' : ''}" data-emp-tab="phases">Phases</button>
        <button class="admin-detail-tab ${employeeDetailTab === 'budget' ? 'active' : ''}" data-emp-tab="budget">Budget</button>
        <button class="admin-detail-tab ${employeeDetailTab === 'invoices' ? 'active' : ''}" data-emp-tab="invoices">Invoices</button>
        <button class="admin-detail-tab ${employeeDetailTab === 'updates' ? 'active' : ''}" data-emp-tab="updates">Updates</button>
        <button class="admin-detail-tab ${employeeDetailTab === 'changeOrders' ? 'active' : ''}" data-emp-tab="changeOrders">Change Orders</button>
        <button class="admin-detail-tab ${employeeDetailTab === 'selections' ? 'active' : ''}" data-emp-tab="selections">Selections</button>
        <button class="admin-detail-tab ${employeeDetailTab === 'documents' ? 'active' : ''}" data-emp-tab="documents">Documents</button>
      </div>

      <div class="admin-detail-tab-content">
    `;

    if (employeeDetailTab === 'updates') {
      html += renderEmployeeUpdatesTab(project);
    } else if (employeeDetailTab === 'phases') {
      html += renderEmployeePhasesTab(project);
    } else if (employeeDetailTab === 'budget') {
      html += renderClientBudget(project);
    } else if (employeeDetailTab === 'documents') {
      html += renderEmployeeDocumentsTab(project);
    } else if (employeeDetailTab === 'selections') {
      html += renderClientSelectionsTab(project);
    } else if (employeeDetailTab === 'changeOrders') {
      html += renderEmployeeChangeOrdersTab(project);
    } else if (employeeDetailTab === 'invoices') {
      html += renderEmployeeInvoicesTab(project);
    }

    html += '</div>';
    return html;
  }

  function renderEmployeeUpdatesTab(project) {
    return renderUpdatesTab(project, 'employee');
  }

  function renderEmployeePhasesTab(project) {
    let tableHtml = '<div class="admin-section"><table class="admin-table"><thead><tr><th>#</th><th>Phase</th><th>Status</th><th>Start</th><th>End</th></tr></thead><tbody>';

    (project.phases || []).forEach((phase, i) => {
      const def = getPhaseDef(i + 1);
      tableHtml += `
        <tr>
          <td>${String(i + 1).padStart(2, '0')}</td>
          <td style="font-family:var(--font-mono);font-size:13px">${escapeHtml(phase.name || def.name)}</td>
          <td>
            <select class="admin-select" data-emp-phase-status="${i}" style="max-width:140px;padding:6px 8px;font-size:12px">
              <option value="upcoming" ${phase.status === 'upcoming' ? 'selected' : ''}>Upcoming</option>
              <option value="in-progress" ${phase.status === 'in-progress' ? 'selected' : ''}>In Progress</option>
              <option value="completed" ${phase.status === 'completed' ? 'selected' : ''}>Completed</option>
            </select>
          </td>
          <td><span style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary)">${formatDate(phase.startDate)}</span></td>
          <td><span style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary)">${formatDate(phase.endDate)}</span></td>
        </tr>
      `;
    });

    tableHtml += '</tbody></table><div class="btn-group"><button class="btn btn-primary btn-small" id="empSavePhaseBtn">Save Phase Changes</button></div></div>';

    const calHtml = renderPhaseCalendar(project.phases, 'employeePhases');

    return '<div class="phases-layout"><div>' + tableHtml + '</div>' + calHtml + '</div>';
  }

  function renderEmployeeDocumentsTab(project) {
    var html = '<div class="admin-section">';
    html += '<div class="doc-upload-area"><h4>Upload Document</h4>';
    html += '<form id="empDocUploadForm">';
    html += '<div class="admin-form-row">';
    html += '<div class="admin-form-group"><label>File</label>';
    html += '<div class="styled-file-upload"><div class="styled-file-upload-label"><strong>Choose a file</strong> or drag it here</div><input type="file" name="docFile" required></div></div>';
    html += '<div class="admin-form-group"><label>Category</label>';
    html += '<select class="admin-select" name="category">';
    DOC_CATEGORIES.forEach(function(c) { html += '<option value="' + c + '">' + c + '</option>'; });
    html += '</select></div></div>';
    html += '<div class="btn-group"><button type="submit" class="btn btn-primary btn-small" id="empDocUploadBtn">Upload Document</button></div>';
    html += '</form></div>';

    if (documentsLoading) {
      html += '<div class="budget-loading"><div class="spinner-large"></div><span class="budget-loading-text">Loading documents...</span></div>';
    } else if (projectDocuments.length === 0) {
      html += '<div class="finances-invoices-empty"><div class="finances-invoices-empty-icon">PM</div><div class="finances-invoices-empty-title">No Documents Yet</div><div class="finances-invoices-empty-msg">Upload plans, permits, and contracts using the form above.</div></div>';
    } else {
      html += renderDocumentList(false);
    }
    html += '</div>';
    return html;
  }

  // ========================================
  // MODALS
  // ========================================

  function renderAddClientModal() {
    return `
      <div class="modal-overlay active" id="modalOverlay">
        <div class="modal">
          <h3>Add New Client</h3>
          <p style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;">A welcome email will be sent so they can set their own password.</p>
          <form id="addClientForm">
            <div class="admin-form-row">
              <div class="admin-form-group admin-form-full">
                <label>Full Name</label>
                <input class="admin-input" type="text" name="name" placeholder="e.g. Alex Johnson" required>
              </div>
            </div>
            <div class="admin-form-row">
              <div class="admin-form-group admin-form-full">
                <label>Email</label>
                <input class="admin-input" type="email" name="email" placeholder="alex@example.com" required>
              </div>
            </div>
            <div class="login-error" id="modalError"></div>
            <div class="btn-group">
              <button type="submit" class="btn btn-primary btn-small" id="modalSubmitBtn">Add Client</button>
              <button type="button" class="btn btn-secondary btn-small" id="cancelModal">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function renderEditClientModal() {
    var client = allUsers.find(function(u) { return u.id === editClientId; });
    if (!client) return '';
    var projectOptions = '<option value="">Unassigned</option>';
    allProjects.forEach(function(p) {
      var sel = (client.projectId === p.id) ? 'selected' : '';
      projectOptions += '<option value="' + p.id + '" ' + sel + '>' + escapeHtml(p.name) + '</option>';
    });
    return `
      <div class="modal-overlay active" id="modalOverlay">
        <div class="modal">
          <h3>Edit Client</h3>
          <form id="editClientForm">
            <input type="hidden" name="uid" value="${editClientId}">
            <div class="admin-form-row">
              <div class="admin-form-group admin-form-full">
                <label>Full Name</label>
                <input class="admin-input" type="text" name="name" value="${escapeAttr(client.name)}" required>
              </div>
            </div>
            <div class="admin-form-row">
              <div class="admin-form-group admin-form-full">
                <label>Email</label>
                <input class="admin-input" type="email" value="${escapeAttr(client.email)}" disabled style="opacity:0.5;">
                <span style="font-size:10px;color:var(--text-tertiary);margin-top:4px;display:block;">Email cannot be changed after creation.</span>
              </div>
            </div>
            <div class="admin-form-row">
              <div class="admin-form-group admin-form-full">
                <label>Assigned Project</label>
                <select class="admin-select" name="projectId">${projectOptions}</select>
              </div>
            </div>
            <div class="login-error" id="modalError"></div>
            <div class="btn-group">
              <button type="submit" class="btn btn-primary btn-small" id="modalSubmitBtn">Save Changes</button>
              <button type="button" class="btn btn-secondary btn-small" id="cancelModal">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function renderAddEmployeeModal() {
    return `
      <div class="modal-overlay active" id="modalOverlay">
        <div class="modal">
          <h3>Add New Employee</h3>
          <form id="addEmployeeForm">
            <div class="admin-form-row">
              <div class="admin-form-group admin-form-full">
                <label>Full Name</label>
                <input class="admin-input" type="text" name="name" placeholder="e.g. Jordan Smith" required>
              </div>
            </div>
            <div class="admin-form-row">
              <div class="admin-form-group admin-form-full">
                <label>Email</label>
                <input class="admin-input" type="email" name="email" placeholder="name@email.com" required>
              </div>
            </div>
            <div class="admin-form-row">
              <div class="admin-form-group admin-form-full">
                <label>Temporary Password</label>
                <input class="admin-input" type="text" name="password" placeholder="Min 6 characters" required minlength="6">
              </div>
            </div>
            <div class="admin-form-row">
              <div class="admin-form-group admin-form-full">
                <label>Assign to Projects</label>
                <div style="border:1px solid var(--border);border-radius:2px;padding:12px;max-height:180px;overflow-y:auto;background:var(--surface)">
                  ${allProjects.length === 0 ? '<p style="font-family:var(--font-mono);font-size:12px;color:var(--text-tertiary);margin:0">No projects available.</p>' : allProjects.map(p => `
                    <label style="display:flex;align-items:center;gap:10px;padding:6px 0;font-family:var(--font-mono);font-size:13px;cursor:pointer">
                      <input type="checkbox" name="assignedProjects" value="${escapeAttr(p.id)}" style="width:14px;height:14px;accent-color:var(--text)">
                      ${escapeHtml(p.name)}
                    </label>
                  `).join('')}
                </div>
              </div>
            </div>
            <div class="login-error" id="modalError"></div>
            <div class="btn-group">
              <button type="submit" class="btn btn-primary btn-small" id="modalSubmitBtn">Add Employee</button>
              <button type="button" class="btn btn-secondary btn-small" id="cancelModal">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function renderNewProjectModal() {
    if (!wizardState) wizardState = wizardDefaultState();
    var s = wizardState;
    var step = s.step;
    var totalSteps = wizardTotalSteps();
    var displayStep = wizardDisplayStep(step);
    var isLast = wizardIsLastStep(step);
    var clients = allUsers.filter(function(u) { return u.role === 'client'; });

    var stepContent = '';

    if (step === 1) {
      // Step 1: Project basics
      stepContent = `
        <div class="wizard-step-title">Project Details</div>
        <div class="admin-form-row">
          <div class="admin-form-group admin-form-full">
            <label>Project Name <span style="color:#A0705A">*</span></label>
            <input class="admin-input" type="text" id="wName" value="${escapeAttr(s.name)}" placeholder="e.g. The Desert Modern">
          </div>
        </div>
        <div class="admin-form-row">
          <div class="admin-form-group">
            <label>Location</label>
            <input class="admin-input" type="text" id="wLocation" value="${escapeAttr(s.location)}" placeholder="e.g. Bend, OR">
          </div>
          <div class="admin-form-group">
            <label>Assign Client</label>
            <select class="admin-select" id="wClient">
              <option value="">— None —</option>
              ${clients.map(function(u) { return '<option value="' + u.id + '"' + (u.id === s.clientId ? ' selected' : '') + '>' + escapeHtml(u.name) + ' (' + escapeHtml(u.email) + ')</option>'; }).join('')}
            </select>
          </div>
        </div>
        <div class="admin-form-row">
          <div class="admin-form-group">
            <label>Start Date</label>
            <input class="admin-input" type="date" id="wStartDate" value="${escapeAttr(s.startDate)}">
          </div>
          <div class="admin-form-group">
            <label>Est. Completion</label>
            <input class="admin-input" type="date" id="wEstCompletion" value="${escapeAttr(s.estCompletion)}">
          </div>
        </div>
        <div class="admin-form-row">
          <div class="admin-form-group admin-form-full">
            <label>Google Sheet URL</label>
            <input class="admin-input" type="url" id="wGoogleSheet" value="${escapeAttr(s.googleSheetUrl)}" placeholder="https://docs.google.com/spreadsheets/d/...">
          </div>
        </div>
      `;
    } else if (step === 2) {
      // Step 2: Project type
      var types = [
        { value: 'new_build', label: 'New Build', desc: 'Ground-up construction on a cleared site' },
        { value: 'remodel',   label: 'Remodel',   desc: 'Renovation of an existing structure' },
        { value: 'addition',  label: 'Addition',  desc: 'Adding square footage to an existing structure' },
        { value: 'adu',       label: 'ADU / Guest House', desc: 'Accessory dwelling unit, detached or attached' }
      ];
      stepContent = '<div class="wizard-step-title">Project Type</div><div class="wizard-choices">';
      types.forEach(function(t) {
        var checked = s.project_type === t.value ? ' checked' : '';
        stepContent += `<label class="wizard-choice${s.project_type === t.value ? ' selected' : ''}">
          <input type="radio" name="wProjectType" value="${t.value}"${checked}>
          <span class="wizard-choice-label">${t.label}</span>
          <span class="wizard-choice-desc">${t.desc}</span>
        </label>`;
      });
      stepContent += '</div>';
    } else if (step === 3) {
      // Step 3: Contract type
      var contracts = [
        { value: 'cost_plus',   label: 'Cost-Plus',    desc: 'Owner pays actual costs plus your stated fee' },
        { value: 'fixed_price', label: 'Fixed-Price',  desc: 'Single contract price — you carry all cost risk' },
        { value: 'gmp',         label: 'GMP',          desc: 'Guaranteed maximum with potential savings split' }
      ];
      stepContent = '<div class="wizard-step-title">Contract Type</div><div class="wizard-choices">';
      contracts.forEach(function(c) {
        var checked = s.contract_type === c.value ? ' checked' : '';
        stepContent += `<label class="wizard-choice${s.contract_type === c.value ? ' selected' : ''}">
          <input type="radio" name="wContractType" value="${c.value}"${checked}>
          <span class="wizard-choice-label">${c.label}</span>
          <span class="wizard-choice-desc">${c.desc}</span>
        </label>`;
      });
      stepContent += '</div>';
    } else if (step === 4) {
      // Step 4: Remodel conditions (only shown for remodel/addition)
      stepContent = `
        <div class="wizard-step-title">Remodel Conditions</div>
        <div class="wizard-choices">
          <label class="wizard-choice${s.include_remodel_conditions !== false ? ' selected' : ''}">
            <input type="radio" name="wRemodelCond" value="yes"${s.include_remodel_conditions !== false ? ' checked' : ''}>
            <span class="wizard-choice-label">Yes — include remodel codes</span>
            <span class="wizard-choice-desc">Seeds Category 26: demolition, site protection, hidden conditions allowance, code upgrades, and matching existing conditions.</span>
          </label>
          <label class="wizard-choice${s.include_remodel_conditions === false ? ' selected' : ''}">
            <input type="radio" name="wRemodelCond" value="no"${s.include_remodel_conditions === false ? ' checked' : ''}>
            <span class="wizard-choice-label">No — skip for this project</span>
            <span class="wizard-choice-desc">You can add any Category 26 codes manually after setup.</span>
          </label>
        </div>
      `;
    } else if (step === 5) {
      // Step 5: Budget detail level
      var tiers = [
        { value: 'simple',   label: 'Simple',   count: '79',  desc: 'Category headers + key sub-items. Best for small jobs and quick estimates.' },
        { value: 'standard', label: 'Standard', count: '253', desc: 'Full sub-code structure. Works for most custom builds and remodels.' },
        { value: 'detailed', label: 'Detailed', count: '257', desc: 'Everything in Standard plus optional labor-split lines for detailed cost-plus tracking.' }
      ];
      var defaultTier = (s.project_type === 'adu' && s.tier === 'standard') ? 'simple' : s.tier;
      stepContent = '<div class="wizard-step-title">Budget Detail Level</div><div class="wizard-choices">';
      tiers.forEach(function(t) {
        var isSelected = defaultTier === t.value;
        stepContent += `<label class="wizard-choice${isSelected ? ' selected' : ''}">
          <input type="radio" name="wTier" value="${t.value}"${isSelected ? ' checked' : ''}>
          <span class="wizard-choice-label">${t.label} <span style="font-weight:400;color:var(--text-secondary);font-size:11px">— ${t.count} lines</span></span>
          <span class="wizard-choice-desc">${t.desc}</span>
        </label>`;
      });
      stepContent += '</div>';
    } else if (step === 6) {
      // Step 6: Specialty modules
      var modules = [
        { value: 'pool_spa',        label: 'Pool / Spa' },
        { value: 'smart_home',      label: 'Smart Home / AV' },
        { value: 'solar',           label: 'Solar / Battery Storage' },
        { value: 'generator',       label: 'Generator' },
        { value: 'landscape',       label: 'Landscape & Irrigation' },
        { value: 'outdoor_kitchen', label: 'Outdoor Kitchen / Fire Pit' },
        { value: 'elevator',        label: 'Elevator / Lift' },
        { value: 'sauna',           label: 'Sauna / Steam' },
        { value: 'wine_room',       label: 'Wine Room' }
      ];
      stepContent = '<div class="wizard-step-title">Specialty Modules</div><p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">Select any that apply. These activate the relevant cost code lines. You can add more after setup.</p><div class="wizard-modules">';
      modules.forEach(function(m) {
        var checked = s.modules.indexOf(m.value) !== -1 ? ' checked' : '';
        stepContent += `<label class="wizard-module${checked ? ' selected' : ''}">
          <input type="checkbox" name="wModules" value="${m.value}"${checked}>
          <span>${m.label}</span>
        </label>`;
      });
      stepContent += '</div><p style="font-size:12px;color:var(--text-secondary);margin-top:12px">You can skip this and continue.</p>';
    } else if (step === 7) {
      // Step 7: Review
      var typeLabels = { new_build: 'New Build', remodel: 'Remodel', addition: 'Addition', adu: 'ADU / Guest House' };
      var contractLabels = { cost_plus: 'Cost-Plus', fixed_price: 'Fixed-Price', gmp: 'GMP' };
      var tierLabels = { simple: 'Simple (~79 lines)', standard: 'Standard (~253 lines)', detailed: 'Detailed (~257 lines)' };
      var modLabel = s.modules.length > 0 ? s.modules.map(function(m) { return m.replace(/_/g,' '); }).join(', ') : 'None';
      stepContent = `
        <div class="wizard-step-title">Review &amp; Create</div>
        <div class="wizard-review">
          <div class="wizard-review-row"><span>Project</span><strong>${escapeHtml(s.name)}${s.location ? ', ' + escapeHtml(s.location) : ''}</strong></div>
          <div class="wizard-review-row"><span>Type</span><strong>${typeLabels[s.project_type] || s.project_type}</strong></div>
          <div class="wizard-review-row"><span>Contract</span><strong>${contractLabels[s.contract_type] || s.contract_type}</strong></div>
          <div class="wizard-review-row"><span>Budget tier</span><strong>${tierLabels[s.tier] || s.tier}</strong></div>
          ${wizardNeedsRemodel() ? '<div class="wizard-review-row"><span>Remodel codes</span><strong>' + (s.include_remodel_conditions !== false ? 'Included' : 'Skipped') + '</strong></div>' : ''}
          <div class="wizard-review-row"><span>Modules</span><strong>${modLabel}</strong></div>
        </div>
        <p style="font-size:12px;color:var(--text-secondary);margin-top:16px">The budget template will be seeded automatically. You can add, remove, or rename any line after the project is created.</p>
      `;
    }

    return `
      <div class="modal-overlay active" id="modalOverlay">
        <div class="modal modal-wizard">
          <div class="wizard-header">
            <h3>New Project</h3>
            <span class="wizard-step-counter">Step ${displayStep} of ${totalSteps}</span>
          </div>
          <div class="wizard-body">
            ${stepContent}
            <div class="login-error" id="modalError"></div>
          </div>
          <div class="wizard-footer">
            ${step > 1 ? '<button class="btn btn-secondary btn-small" id="wizardBack">← Back</button>' : '<span></span>'}
            <button class="btn btn-secondary btn-small" id="cancelModal">Cancel</button>
            ${isLast
              ? '<button class="btn btn-primary btn-small" id="wizardCreate">Create Project</button>'
              : '<button class="btn btn-primary btn-small" id="wizardNext">Next →</button>'
            }
          </div>
        </div>
      </div>
    `;
  }

  function renderEditProjectModal() {
    return ''; // Handled inline in admin detail
  }

  // ========================================
  // ADMIN EVENT BINDING
  // ========================================

  function bindAdminEvents() {
    document.getElementById('logoutBtn')?.addEventListener('click', logout);

    // Nav
    document.querySelectorAll('[data-admin-nav]').forEach(btn => {
      btn.addEventListener('click', async () => {
        adminView = btn.dataset.adminNav;
        adminSelectedProject = null;
        adminDetailTab = 'details';
        await refreshAdminData();
        render();
      });
    });

    // Project cards
    document.querySelectorAll('[data-project-id]').forEach(card => {
      card.addEventListener('click', async () => {
        adminSelectedProject = card.dataset.projectId;
        adminView = 'detail';
        adminDetailTab = 'details';
        firestoreBudgetItems = [];
        budgetLoadedForProject = null;
        currentMessages = [];
        updateHash(true); // push — so back button returns to project list
        render();
      });
    });

    // Dashboard project table rows
    document.querySelectorAll('[data-dashboard-project]').forEach(function(row) {
      row.addEventListener('click', async function() {
        adminSelectedProject = row.dataset.dashboardProject;
        adminView = 'detail';
        adminDetailTab = 'details';
        firestoreBudgetItems = [];
        budgetLoadedForProject = null;
        currentMessages = [];
        updateHash(true); // push
        render();
      });
    });

    // New project card
    document.getElementById('newProjectCard')?.addEventListener('click', () => {
      wizardState = wizardDefaultState();
      showModal = 'newProject';
      render();
    });

    // Back button
    document.getElementById('adminBackBtn')?.addEventListener('click', async () => {
      adminView = 'overview';
      adminSelectedProject = null;
      adminDetailTab = 'details';
      adminPreviewClientView = false;
      firestoreBudgetItems = [];
      budgetLoadedForProject = null;
      projectPhotos = [];
      projectDocuments = [];
      projectSelections = [];
      currentChangeOrders = [];
      updateHash(true); // push — forward button can return to this project
      currentInvoices = [];
      currentMessages = [];
      lightboxPhoto = null;
      await refreshAdminData();
      render();
    });

    // Preview client view
    document.getElementById('previewClientViewBtn')?.addEventListener('click', () => {
      adminPreviewClientView = true;
      clientView = 'dashboard';
      render();
    });

    // Exit preview
    document.getElementById('exitPreviewBtn')?.addEventListener('click', () => {
      adminPreviewClientView = false;
      clientView = 'dashboard';
      render();
    });

    // Client nav in preview mode
    if (adminPreviewClientView) {
      document.querySelectorAll('[data-client-nav]').forEach(btn => {
        btn.addEventListener('click', () => {
          clientView = btn.dataset.clientNav;
          // Lazy load data for preview
          const pid = adminSelectedProject;
          if (clientView === 'finances') {
            if (firestoreBudgetItems.length === 0 && !firestoreBudgetLoading) loadBudgetItems(pid);
            if (currentInvoices.length === 0 && !invoicesLoading) loadInvoices(pid);
          }
          if (clientView === 'documents' && projectDocuments.length === 0) loadDocuments(pid);
          if (clientView === 'selections' && projectSelections.length === 0) loadSelections(pid);
          if (clientView === 'updates' && currentMessages.length === 0) loadMessages(pid);
          if (clientView === 'changeOrders' && currentChangeOrders.length === 0) {
            loadChangeOrders(pid).then(() => { bindClientChangeOrderEvents(); });
          } else if (clientView === 'changeOrders') {
            render();
            bindClientChangeOrderEvents();
            return;
          }
          if (clientView === 'selections' && projectSelections.length > 0) {
            render();
            bindClientSelectionApproveEvents();
            return;
          }
          window.scrollTo(0, 0);
          render();
        });
      });
    }

    // Detail sub-tab navigation
    document.querySelectorAll('[data-detail-tab]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tab = btn.dataset.detailTab;
        adminDetailTab = tab;
        updateHash();
        window.scrollTo(0, 0);
        if (tab === 'budget') {
          const proj = allProjects.find(p => p.id === adminSelectedProject);
          const projHasSheet = proj && proj.googleSheetUrl && extractSheetId(proj.googleSheetUrl);
          if (projHasSheet) {
            // Sheets mode: always re-fetch live data
            budgetData = null;
            budgetFetchError = null;
            render();
            fetchBudgetData();
            return;
          } else if (firestoreBudgetItems.length === 0 && !firestoreBudgetLoading) {
            await loadBudgetItems(adminSelectedProject);
            return;
          }
        }
        if (tab === 'updates' && currentMessages.length === 0 && !messagesLoading) {
          await loadMessages(adminSelectedProject);
          return;
        }
        if (tab === 'photos' && projectPhotos.length === 0 && !photosLoading) {
          await loadPhotos(adminSelectedProject);
          return;
        }
        if (tab === 'documents' && projectDocuments.length === 0 && !documentsLoading) {
          await loadDocuments(adminSelectedProject);
          return;
        }
        if (tab === 'selections' && projectSelections.length === 0 && !selectionsLoading) {
          await loadSelections(adminSelectedProject);
          return;
        }
        if (tab === 'changeOrders' && currentChangeOrders.length === 0 && !changeOrdersLoading) {
          await loadChangeOrders(adminSelectedProject);
          return;
        }
        if (tab === 'invoices' && currentInvoices.length === 0 && !invoicesLoading) {
          await loadInvoices(adminSelectedProject);
          return;
        }
        // Load QBO customers when Details tab opened (for dropdown)
        if (tab === 'details' && qboConnected && qboCustomers.length === 0) {
          loadQboCustomers(); // async, non-blocking — re-renders when done
        }
        render();
        if (tab === 'updates') {
          bindUpdatesEvents(adminSelectedProject, 'admin');
        }
        if (tab === 'invoices') {
          bindAdminInvoiceEvents();
        }
      });
    });

    // Project details form
    document.getElementById('adminProjectForm')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('saveDetailsBtn');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      const fd = new FormData(this);
      const project = allProjects.find(p => p.id === adminSelectedProject);
      if (!project) return;

      const newClientId = fd.get('clientId') || '';
      const oldClientId = project.clientId || '';

      const updates = {
        name: fd.get('name'),
        location: fd.get('location'),
        startDate: fd.get('startDate'),
        estCompletion: fd.get('estCompletion'),
        clientId: newClientId,
        googleSheetUrl: fd.get('googleSheetUrl') || '',
        heroImageUrl: fd.get('heroImageUrl') || '',
        qboCustomerId: fd.get('qboCustomerId') || ''
      };

      // Find client name
      if (newClientId) {
        const c = allUsers.find(u => u.id === newClientId);
        updates.clientName = c ? c.name : '';
      } else {
        updates.clientName = '';
      }

      try {
        await updateProject(adminSelectedProject, updates);

        // Update client projectId references
        if (oldClientId && oldClientId !== newClientId) {
          await db.collection('users').doc(oldClientId).update({ projectId: '' });
        }
        if (newClientId && newClientId !== oldClientId) {
          await db.collection('users').doc(newClientId).update({ projectId: adminSelectedProject });
        }

        await refreshAdminData();
        showToast('Project details saved.');
        render();
      } catch (err) {
        showToast('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Save Details';
      }
    });

    // QBO: Refresh customer list on Details tab
    document.getElementById('loadQboCustomersBtn')?.addEventListener('click', async function() {
      var btn = document.getElementById('loadQboCustomersBtn');
      btn.disabled = true;
      btn.textContent = 'Loading...';
      try {
        await loadQboCustomers();
        render();
        showToast('QBO customer list refreshed (' + qboCustomers.length + ' customers).');
      } catch (err) {
        showToast('Error loading QBO customers: ' + (err.message || 'Unknown error'));
        btn.disabled = false;
        btn.textContent = 'Refresh QBO Customers';
      }
    });

    // Phase management
    document.getElementById('savePhaseBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('savePhaseBtn');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      const project = allProjects.find(p => p.id === adminSelectedProject);
      if (!project || !project.phases) return;

      const updatedPhases = project.phases.map((phase, i) => {
        const nameInput = document.querySelector('[data-phase-name="' + i + '"]');
        const statusSelect = document.querySelector('[data-phase-status="' + i + '"]');
        const startInput = document.querySelector('[data-phase-date="' + i + '"][data-date-type="start"]');
        const endInput = document.querySelector('[data-phase-date="' + i + '"][data-date-type="end"]');

        return {
          ...phase,
          name: nameInput ? nameInput.value.trim() : phase.name,
          status: statusSelect ? statusSelect.value : phase.status,
          startDate: startInput ? startInput.value : phase.startDate,
          endDate: endInput ? endInput.value : phase.endDate
        };
      });

      try {
        await updateProject(adminSelectedProject, { phases: updatedPhases });
        await refreshAdminData();
        showToast('Phase changes saved.');
        var phaseProject = allProjects.find(function(p) { return p.id === adminSelectedProject; });
        if (phaseProject) {
          var pClientEmail = getClientEmailForProject(phaseProject);
          if (pClientEmail) {
            sendEmailNotification(pClientEmail,
              phaseProject.name + ' — Phase Update',
              buildEmailHtml(phaseProject.name, 'Phase Update',
                '<p style="color:#555;font-size:14px;">Project phases have been updated. Log in to see the latest status.</p>'
              )
            );
          }
        }
        render();
      } catch (err) {
        showToast('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Save Phase Changes';
      }
    });

    // Add new phase
    document.getElementById('downloadPhasesPdfBtn')?.addEventListener('click', () => {
      const project = allProjects.find(p => p.id === adminSelectedProject);
      if (project) downloadPhasesPdf(project);
    });

    document.getElementById('addPhaseBtn')?.addEventListener('click', async () => {
      const project = allProjects.find(p => p.id === adminSelectedProject);
      if (!project) return;

      const phaseName = prompt('Phase name:');
      if (!phaseName || !phaseName.trim()) return;

      const phases = project.phases || [];
      phases.push({
        name: phaseName.trim(),
        status: 'upcoming',
        startDate: '',
        endDate: '',
        description: ''
      });

      try {
        await updateProject(adminSelectedProject, { phases });
        await refreshAdminData();
        showToast('Phase added.');
        render();
      } catch (err) {
        showToast('Error: ' + err.message);
      }
    });

    // Admin updates events
    if (adminView === 'detail' && adminDetailTab === 'updates') {
      bindUpdatesEvents(adminSelectedProject, 'admin');
    }

    // Admin budget events
    if (adminView === 'detail' && adminDetailTab === 'budget') {
      bindAdminBudgetEvents();
      var curProject = allProjects.find(function(p){ return p.id === adminSelectedProject; });
      if (curProject && isTemplatedProject(curProject)) {
        // Trigger load if we haven't loaded for this specific project yet
        if (budgetLoadedForProject !== adminSelectedProject && !firestoreBudgetLoading) {
          loadBudgetItems(adminSelectedProject);
        }
        bindTemplateBudgetEvents(adminSelectedProject);
      }
    }

    // Admin photos events
    if (adminView === 'detail' && adminDetailTab === 'photos') {
      bindAdminPhotoEvents();
    }

    // Admin documents events
    if (adminView === 'detail' && adminDetailTab === 'documents') {
      bindAdminDocumentEvents();
    }

    // Admin selections events
    if (adminView === 'detail' && adminDetailTab === 'selections') {
      bindAdminSelectionEvents();
    }

    // Admin change orders events
    if (adminView === 'detail' && adminDetailTab === 'changeOrders') {
      bindAdminChangeOrderEvents();
    }

    // Admin invoices events
    if (adminView === 'detail' && adminDetailTab === 'invoices') {
      bindAdminInvoiceEvents();
    }

    // Phase calendar nav events
    if (adminView === 'detail' && adminDetailTab === 'phases') {
      var phaseCalProject = allProjects.find(function(p) { return p.id === adminSelectedProject; });
      if (phaseCalProject) bindCalendarNav(phaseCalProject.phases, 'adminPhases');
    }

    // Lightbox events
    bindLightboxEvents();

    // Add client button
    document.getElementById('addClientBtn')?.addEventListener('click', () => {
      showModal = 'addClient';
      render();
    });

    // Edit client buttons
    document.querySelectorAll('[data-edit-client]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        editClientId = btn.dataset.editClient;
        showModal = 'editClient';
        render();
      });
    });

    // Delete client buttons
    document.querySelectorAll('[data-delete-client]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var uid = btn.dataset.deleteClient;
        var name = btn.dataset.deleteClientName;
        if (!confirm('Delete client "' + name + '"? This will remove their account and portal access.')) return;
        try {
          // Delete Firestore user doc
          await db.collection('users').doc(uid).delete();
          // Delete Auth account via Cloud Function
          var deleteClientFn = firebase.functions().httpsCallable('deleteClientAccount');
          await deleteClientFn({ uid: uid });
          await loadAllUsers();
          showToast('Client deleted.');
          render();
        } catch (err) {
          // If Cloud Function fails, Firestore doc is already deleted
          console.warn('Delete client error:', err.message);
          await loadAllUsers();
          showToast('Client removed. Auth account may need manual cleanup in Firebase Console.');
          render();
        }
      });
    });

    // Add employee button
    document.getElementById('addEmployeeBtn')?.addEventListener('click', () => {
      showModal = 'addEmployee';
      render();
    });

    // Modal events
    bindModalEvents();

    // Budget item modal events
    bindBudgetModalEvents();
  }

  // ========================================
  // TEMPLATE BUDGET EVENT BINDING
  // ========================================
  function bindTemplateBudgetEvents(projectId) {
    var project = allProjects.find(function(p){ return p.id === projectId; });

    // Load master template for restore (async, re-renders when ready)
    loadMasterTemplateCache();

    // Restore all missing lines across the whole budget
    var restoreAllBtn = document.getElementById('tRestoreAllBtn');
    if (restoreAllBtn) {
      restoreAllBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (!project) return;
        if (!confirm('Restore all missing template lines to this budget? Existing amounts will not be changed.')) return;
        restoreMissingLines(projectId, project, null);
      });
    }

    // Restore missing lines for a specific category
    document.querySelectorAll('[data-restore-cat]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var catCode = this.dataset.restoreCat;
        if (!project) return;
        restoreMissingLines(projectId, project, catCode);
      });
    });

    // Expand / collapse categories
    document.querySelectorAll('[data-toggle-cat]').forEach(function(el) {
      el.addEventListener('click', function(e) {
        // Don't trigger if clicking inside an input or select
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        var cat = this.dataset.toggleCat;
        budgetCategoryOpen[cat] = !budgetCategoryOpen[cat];
        render();
      });
    });

    // Inline budget / actual inputs — save on blur, update summary live
    document.querySelectorAll('.tbudget-input').forEach(function(input) {
      // Prevent category toggle from firing when clicking input
      input.addEventListener('click', function(e) { e.stopPropagation(); });

      input.addEventListener('change', function() {
        var itemId = this.dataset.budgetItem;
        var field  = this.dataset.budgetField;
        var value  = this.value !== '' ? parseFloat(this.value) : null;

        // Optimistic in-memory update
        var item = firestoreBudgetItems.find(function(i) { return i.id === itemId; });
        if (item) item[field] = value;

        // Update summary bar numbers in-place (no full re-render)
        refreshTemplateBudgetSummary();

        // Debounced Firestore write
        clearTimeout(budgetSaveTimer);
        budgetSaveTimer = setTimeout(function() {
          var update = { updated_at: firebase.firestore.FieldValue.serverTimestamp() };
          update[field] = value;
          db.collection('projects').doc(projectId)
            .collection('budgetItems').doc(itemId)
            .update(update)
            .catch(function(e){ console.error('[Budget] Save failed:', e); });
        }, 800);
      });
    });

    // Status dropdowns — save immediately on change
    document.querySelectorAll('.tbudget-status').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var itemId = this.dataset.budgetItemStatus;
        var status = this.value;
        var item = firestoreBudgetItems.find(function(i){ return i.id === itemId; });
        if (item) item.status = status;
        db.collection('projects').doc(projectId)
          .collection('budgetItems').doc(itemId)
          .update({ status: status, updated_at: firebase.firestore.FieldValue.serverTimestamp() })
          .catch(function(e){ console.error('[Budget] Status save failed:', e); });
      });
    });

    // Edit line — open inline edit form
    document.querySelectorAll('[data-budget-item-edit]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var itemId = this.dataset.budgetItemEdit;
        var item = firestoreBudgetItems.find(function(i){ return i.id === itemId; });
        if (!item) return;
        budgetCategoryOpen[item.top_level_category] = true;
        budgetEditingLine = itemId;
        budgetAddingToCategory = null;
        render();
      });
    });

    // Save edit
    var saveBtn = document.getElementById('tEditSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function() {
        var itemId = this.dataset.budgetItemSave;
        saveBudgetLineEdit(projectId, itemId);
      });
    }

    // Cancel edit
    var cancelBtn = document.getElementById('tEditCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        budgetEditingLine = null;
        render();
      });
    }

    // Delete line
    document.querySelectorAll('[data-budget-item-delete]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var itemId   = this.dataset.budgetItemDelete;
        var itemName = this.dataset.itemName;
        deleteBudgetLine(projectId, itemId, itemName);
      });
    });

    // Open add-line form
    document.querySelectorAll('[data-add-line-cat]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        budgetAddingToCategory = this.dataset.addLineCat;
        budgetEditingLine = null;
        render();
      });
    });

    // Save new custom line
    var addSaveBtn = document.getElementById('tAddSaveBtn');
    if (addSaveBtn) {
      addSaveBtn.addEventListener('click', function() {
        var catCode = this.dataset.addToCat;
        var catName = this.dataset.catName;
        addCustomBudgetLine(projectId, catCode, catName);
      });
    }

    // Cancel add
    var addCancelBtn = document.getElementById('tAddCancelBtn');
    if (addCancelBtn) {
      addCancelBtn.addEventListener('click', function() {
        budgetAddingToCategory = null;
        render();
      });
    }
  }

  // Update summary bar numbers without full re-render
  function refreshTemplateBudgetSummary() {
    var totals = getTemplatedBudgetTotals();
    var pct = totals.budget > 0 ? Math.min(100, (totals.actual / totals.budget) * 100) : 0;
    var tBudget  = document.getElementById('tbudget-total-budget');
    var tActual  = document.getElementById('tbudget-total-actual');
    var tVar     = document.getElementById('tbudget-total-variance');
    var tFill    = document.getElementById('tbudget-progress-fill');
    var tLabel   = document.getElementById('tbudget-progress-label');
    if (tBudget)  tBudget.textContent  = formatCurrency(totals.budget);
    if (tActual)  tActual.textContent  = formatCurrency(totals.actual);
    if (tVar)   { tVar.textContent = formatCurrency(totals.variance); tVar.style.color = totals.variance < 0 ? '#A0705A' : ''; }
    if (tFill)    tFill.style.width   = pct.toFixed(1) + '%';
    if (tLabel)   tLabel.textContent  = pct.toFixed(1) + '% of budget spent';
  }

  function bindAdminBudgetEvents() {
    // Download PDF (appears in both modes)
    document.getElementById('downloadBudgetPdfBtn')?.addEventListener('click', () => {
      const project = allProjects.find(p => p.id === (userProfile.projectId || adminSelectedProject));
      if (project) downloadBudgetPdf(project);
    });

    // ── SHEET MODE BUTTONS ────────────────────────────────

    // Refresh / Retry button (sheet mode)
    document.getElementById('sheetBudgetRefreshBtn')?.addEventListener('click', () => {
      budgetData = null;
      budgetFetchError = null;
      fetchBudgetData();
    });

    // Unlink Sheet button
    document.getElementById('unlinkSheetBtn')?.addEventListener('click', async () => {
      if (!confirm('Unlink Google Sheet? The budget will switch to portal editor mode. Any data currently in the sheet won\'t be copied over.')) return;
      try {
        await updateProject(adminSelectedProject, { googleSheetUrl: '' });
        await refreshAdminData();
        budgetData = null;
        budgetFetchError = null;
        showToast('Google Sheet unlinked. Switched to portal editor mode.');
        render();
      } catch (err) {
        showToast('Error unlinking sheet: ' + err.message);
      }
    });

    // Collapsible row toggles (sheet mode read-only table)
    document.querySelectorAll('[data-budget-cat]').forEach(row => {
      row.addEventListener('click', () => {
        const catIndex = parseInt(row.dataset.budgetCat);
        budgetExpandedCategories[catIndex] = !budgetExpandedCategories[catIndex];
        const toggle = row.querySelector('.budget-category-toggle');
        if (toggle) toggle.classList.toggle('open');
        document.querySelectorAll('[data-budget-cat-child="' + catIndex + '"]').forEach(child => {
          child.classList.toggle('expanded');
        });
      });
    });

    // ── PORTAL EDITOR MODE BUTTONS ───────────────────────────

    document.getElementById('addBudgetItemBtn')?.addEventListener('click', () => {
      editingBudgetItem = null;
      showBudgetModal = true;
      render();
    });

    // Import from sheets button (one-time import into Firestore)
    document.getElementById('importSheetsBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('importSheetsBtn');
      if (!confirm('Import budget data from Google Sheets? This will create budget items from the spreadsheet.')) return;
      btn.disabled = true;
      btn.textContent = 'Importing...';
      try {
        const count = await importBudgetFromSheets(adminSelectedProject);
        showToast(count + ' budget items imported.');
        await loadBudgetItems(adminSelectedProject);
      } catch (err) {
        showToast('Import error: ' + err.message);
        btn.disabled = false;
        btn.textContent = '→ Import from Google Sheets';
      }
    });

    // Edit budget item buttons
    document.querySelectorAll('[data-edit-budget]').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.editBudget;
        const item = firestoreBudgetItems.find(i => i.id === itemId);
        if (item) {
          editingBudgetItem = { ...item };
          showBudgetModal = true;
          render();
        }
      });
    });

    // Delete budget item buttons
    document.querySelectorAll('[data-delete-budget]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this budget item?')) return;
        const itemId = btn.dataset.deleteBudget;
        try {
          await deleteBudgetItem(adminSelectedProject, itemId);
          await loadBudgetItems(adminSelectedProject);
          showToast('Budget item deleted.');
        } catch (err) {
          showToast('Error: ' + err.message);
        }
      });
    });
  }

  // ========================================
  // NEW FEATURE EVENT BINDINGS
  // ========================================

  function bindAdminPhotoEvents() {
    // Photo upload form
    document.getElementById('photoUploadForm')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('photoUploadBtn');
      var fileInput = this.querySelector('[name="photoFile"]');
      var file = fileInput.files[0];
      if (!file) return;
      btn.disabled = true;
      var isHeic = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');
      btn.textContent = isHeic ? 'Converting & uploading...' : 'Uploading...';
      try {
        var caption = this.querySelector('[name="caption"]').value.trim();
        var phase = this.querySelector('[name="phase"]').value;
        await uploadPhoto(adminSelectedProject, file, caption, phase);
        showToast('Photo uploaded.');
        await loadPhotos(adminSelectedProject);
      } catch (err) {
        showToast('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Upload Photo';
      }
    });

    // Delete photo buttons
    document.querySelectorAll('[data-delete-photo]').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        if (!confirm('Delete this photo?')) return;
        try {
          await deletePhoto(adminSelectedProject, btn.dataset.deletePhoto);
          showToast('Photo deleted.');
          await loadPhotos(adminSelectedProject);
        } catch (err) {
          showToast('Error: ' + err.message);
        }
      });
    });

    // Lightbox on photo cards
    bindLightboxEvents();
  }

  function bindAdminDocumentEvents() {
    // Document upload form
    document.getElementById('docUploadForm')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('docUploadBtn');
      var fileInput = this.querySelector('[name="docFile"]');
      var file = fileInput.files[0];
      if (!file) return;
      btn.disabled = true;
      btn.textContent = 'Uploading...';
      try {
        var category = this.querySelector('[name="category"]').value;
        await uploadDocument(adminSelectedProject, file, category);
        showToast('Document uploaded.');
        await loadDocuments(adminSelectedProject);
      } catch (err) {
        showToast('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Upload Document';
      }
    });

    // Delete document buttons
    document.querySelectorAll('[data-delete-doc]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (!confirm('Delete this document?')) return;
        try {
          await deleteDocument(adminSelectedProject, btn.dataset.deleteDoc);
          showToast('Document deleted.');
          await loadDocuments(adminSelectedProject);
        } catch (err) {
          showToast('Error: ' + err.message);
        }
      });
    });
  }

  function bindAdminSelectionEvents() {
    // Selection add form
    document.getElementById('selectionAddForm')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('selectionAddBtn');
      btn.disabled = true;
      btn.textContent = 'Adding...';
      try {
        var name = this.querySelector('[name="selName"]').value.trim();
        var category = this.querySelector('[name="selCategory"]').value;
        var status = this.querySelector('[name="selStatus"]').value;
        var cost = this.querySelector('[name="selCost"]').value;
        var notes = this.querySelector('[name="selNotes"]').value.trim();
        var imageInput = this.querySelector('[name="selImage"]');
        var imageUrl = '';
        if (imageInput.files[0]) {
          imageUrl = await uploadSelectionImage(adminSelectedProject, imageInput.files[0]);
        }
        await addSelection(adminSelectedProject, {
          name: name,
          category: category,
          status: status,
          cost: cost,
          notes: notes,
          imageUrl: imageUrl
        });
        showToast('Selection added.');
        await loadSelections(adminSelectedProject);
      } catch (err) {
        showToast('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Add Selection';
      }
    });

    // Inline status update for selections
    document.querySelectorAll('[data-sel-status]').forEach(function(sel) {
      sel.addEventListener('change', async function() {
        try {
          await updateSelection(adminSelectedProject, sel.dataset.selStatus, { status: sel.value });
          // Update local state
          var item = projectSelections.find(function(s) { return s.id === sel.dataset.selStatus; });
          if (item) item.status = sel.value;
          showToast('Status updated.');
        } catch (err) {
          showToast('Error: ' + err.message);
        }
      });
    });

    // Delete selection buttons
    document.querySelectorAll('[data-delete-sel]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (!confirm('Delete this selection?')) return;
        try {
          await deleteSelection(adminSelectedProject, btn.dataset.deleteSel);
          showToast('Selection deleted.');
          await loadSelections(adminSelectedProject);
        } catch (err) {
          showToast('Error: ' + err.message);
        }
      });
    });

    // Lightbox for selection images
    bindLightboxEvents();
  }

  function bindAdminChangeOrderEvents() {
    // Add change order form
    document.getElementById('addChangeOrderForm')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('addChangeOrderBtn');
      btn.disabled = true;
      btn.textContent = 'Adding...';
      try {
        var title = this.querySelector('[name="coTitle"]').value.trim();
        var description = this.querySelector('[name="coDescription"]').value.trim();
        var costImpact = Number(this.querySelector('[name="coCostImpact"]').value) || 0;
        var requestedBy = this.querySelector('[name="coRequestedBy"]').value;
        await addChangeOrder(adminSelectedProject, { title: title, description: description, costImpact: costImpact, requestedBy: requestedBy });
        showToast('Change order added.');
        var coProject = allProjects.find(function(p) { return p.id === adminSelectedProject; });
        if (coProject) {
          var coClientEmail = getClientEmailForProject(coProject);
          if (coClientEmail) {
            var coAmountStr = (costImpact >= 0 ? '+' : '') + formatCurrency(costImpact);
            sendEmailNotification(coClientEmail,
              coProject.name + ' — New Change Order: ' + title,
              buildEmailHtml(coProject.name, 'New Change Order',
                '<p style="font-size:16px;font-weight:700;margin:0 0 8px;">' + escapeHtml(title) + '</p>' +
                '<p style="color:#555;font-size:14px;line-height:1.6;">' + escapeHtml(description) + '</p>' +
                '<p style="font-size:14px;margin-top:12px;">Cost Impact: <strong>' + coAmountStr + '</strong></p>' +
                '<p style="color:#8A7B6B;font-size:12px;margin-top:8px;">Please log in to approve or deny this change order.</p>'
              )
            );
          }
        }
        await loadChangeOrders(adminSelectedProject);
      } catch (err) {
        showToast('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Add Change Order';
      }
    });

    // Delete change order buttons
    document.querySelectorAll('[data-delete-co]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (!confirm('Delete this change order?')) return;
        try {
          await deleteChangeOrder(adminSelectedProject, btn.dataset.deleteCo);
          showToast('Change order deleted.');
          await loadChangeOrders(adminSelectedProject);
        } catch (err) {
          showToast('Error: ' + err.message);
        }
      });
    });

    // Download PDF
    document.getElementById('downloadCoPdfBtn')?.addEventListener('click', function() {
      var project = allProjects.find(function(p) { return p.id === adminSelectedProject; });
      if (project) downloadChangeOrdersPdf(project);
    });
  }

  function bindClientSelectionApproveEvents() {
    var selPid = userProfile.projectId;
    document.querySelectorAll('[data-sel-approve]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var selId = btn.dataset.selApprove;
        var selName = btn.dataset.selName || 'Selection';
        openSignatureModal('Selection: ' + selName, async function(signatureData) {
          btn.disabled = true;
          btn.textContent = 'Approving...';
          try {
            await updateSelection(selPid, selId, {
              status: 'Approved',
              approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
              signature: signatureData,
              signedBy: (userProfile && userProfile.name) ? userProfile.name : ''
            });
            showToast('Selection approved.');
            await loadSelections(selPid);
          } catch (err) {
            showToast('Error: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Approve';
          }
        });
      });
    });
  }

  function bindClientChangeOrderEvents() {
    var pid = userProfile.projectId;
    var project = allProjects.find(function(p) { return p.id === pid; });

    // Approve buttons — open signature modal before approving
    document.querySelectorAll('[data-co-approve]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var coId = btn.dataset.coApprove;
        var co = currentChangeOrders.find(function(c) { return c.id === coId; });
        var coTitle = co ? (co.title || 'Change Order') : 'Change Order';
        var noteEl = document.getElementById('coNote_' + coId);
        var note = noteEl ? noteEl.value.trim() : '';
        openSignatureModal('Change Order: ' + coTitle, async function(signatureData) {
          btn.disabled = true;
          btn.textContent = 'Approving...';
          try {
            await updateChangeOrderStatus(pid, coId, 'approved', note, signatureData);
            showToast('Change order approved.');
            var coResProject = allProjects.find(function(p) { return p.id === userProfile.projectId; });
            if (coResProject) {
              var adminEmail = getAdminEmail();
              if (adminEmail) {
                sendEmailNotification(adminEmail,
                  coResProject.name + ' — Change Order Approved',
                  buildEmailHtml(coResProject.name, 'Change Order Approved',
                    '<p style="color:#555;font-size:14px;">A change order has been <strong>approved</strong> by the client.</p>'
                  )
                );
              }
            }
            await loadChangeOrders(pid);
          } catch (err) {
            showToast('Error: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Approve';
          }
        });
      });
    });

    // Deny buttons
    document.querySelectorAll('[data-co-deny]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var coId = btn.dataset.coDeny;
        var noteEl = document.getElementById('coNote_' + coId);
        var note = noteEl ? noteEl.value.trim() : '';
        btn.disabled = true;
        btn.textContent = 'Denying...';
        try {
          await updateChangeOrderStatus(pid, coId, 'denied', note);
          showToast('Change order denied.');
          var coResProject2 = allProjects.find(function(p) { return p.id === userProfile.projectId; });
          if (coResProject2) {
            var adminEmail2 = getAdminEmail();
            if (adminEmail2) {
              sendEmailNotification(adminEmail2,
                coResProject2.name + ' — Change Order Denied',
                buildEmailHtml(coResProject2.name, 'Change Order Denied',
                  '<p style="color:#555;font-size:14px;">A change order has been <strong>denied</strong> by the client.</p>'
                )
              );
            }
          }
          await loadChangeOrders(pid);
        } catch (err) {
          showToast('Error: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Deny';
        }
      });
    });

    // Download PDF — summary bar (all COs)
    document.getElementById('downloadCoPdfBtn')?.addEventListener('click', function() {
      var pid2 = userProfile.projectId;
      var proj2 = allProjects.find(function(p) { return p.id === pid2; });
      if (proj2) {
        try { downloadChangeOrdersPdf(proj2); } catch(e) { showToast('PDF error: ' + e.message); }
      } else {
        showToast('Could not find project. Please refresh and try again.');
      }
    });

    // Download PDF — per-CO card button
    document.querySelectorAll('[data-co-download]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var coId = this.dataset.coDownload;
        var co = currentChangeOrders.find(function(c) { return c.id === coId; });
        var pid2 = userProfile.projectId;
        var proj2 = allProjects.find(function(p) { return p.id === pid2; });
        if (co && proj2) {
          downloadSingleChangeOrderPdf(proj2, co);
        } else {
          showToast('Could not generate PDF. Please refresh and try again.');
        }
      });
    });
  }

  function bindLightboxEvents() {
    // Open lightbox
    document.querySelectorAll('[data-photo-lightbox]').forEach(function(el) {
      el.addEventListener('click', function(e) {
        // Don't trigger if clicking delete button
        if (e.target.closest('[data-delete-photo]')) return;
        lightboxPhoto = {
          url: el.dataset.photoLightbox,
          caption: el.dataset.photoCaption || ''
        };
        render();
      });
    });

    // Close lightbox
    document.getElementById('photoLightbox')?.addEventListener('click', function() {
      lightboxPhoto = null;
      render();
    });
  }

  function bindBudgetModalEvents() {
    // Category select toggle for custom
    document.getElementById('budgetCatSelect')?.addEventListener('change', function() {
      const customRow = document.getElementById('customCatRow');
      if (this.value === '__custom') {
        customRow.style.display = '';
        document.getElementById('customCatInput')?.focus();
      } else {
        customRow.style.display = 'none';
      }
    });

    // Cancel budget modal
    document.getElementById('budgetModalCancel')?.addEventListener('click', () => {
      showBudgetModal = false;
      editingBudgetItem = null;
      render();
    });

    // Close on overlay click
    document.getElementById('budgetModalOverlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'budgetModalOverlay') {
        showBudgetModal = false;
        editingBudgetItem = null;
        render();
      }
    });

    // Submit budget item form
    document.getElementById('budgetItemForm')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('budgetModalSubmit');
      const errEl = document.getElementById('budgetModalError');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      errEl.textContent = '';

      const fd = new FormData(this);
      const catSelect = fd.get('categorySelect');
      const category = catSelect === '__custom' ? (fd.get('customCategory') || '').trim() : (catSelect || '');

      const data = {
        costCode: fd.get('costCode').trim(),
        description: '',
        vendor: (fd.get('vendor') || '').trim(),
        budgetAmount: Number(fd.get('budgetAmount')) || 0,
        actualAmount: Number(fd.get('actualAmount')) || 0,
        status: fd.get('status') || 'pending',
        category: category,
        notes: (fd.get('notes') || '').trim()
      };

      try {
        if (editingBudgetItem && editingBudgetItem.id) {
          await updateBudgetItem(adminSelectedProject, editingBudgetItem.id, data);
          showToast('Budget item updated.');
        } else {
          await addBudgetItem(adminSelectedProject, data);
          showToast('Budget item added.');
        }
        showBudgetModal = false;
        editingBudgetItem = null;
        await loadBudgetItems(adminSelectedProject);
      } catch (err) {
        errEl.textContent = err.message;
        btn.disabled = false;
        btn.textContent = editingBudgetItem ? 'Save Changes' : 'Add Item';
      }
    });
  }

  function bindModalEvents() {
    document.getElementById('cancelModal')?.addEventListener('click', () => {
      showModal = null;
      render();
    });

    document.getElementById('modalOverlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'modalOverlay') {
        showModal = null;
        render();
      }
    });

    // Add employee form
    document.getElementById('addEmployeeForm')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('modalSubmitBtn');
      const errEl = document.getElementById('modalError');
      btn.disabled = true;
      btn.textContent = 'Creating...';
      errEl.textContent = '';

      const fd = new FormData(this);
      const email = fd.get('email').trim().toLowerCase();
      const password = fd.get('password');
      const name = fd.get('name').trim();
      const assignedProjects = Array.from(this.querySelectorAll('[name="assignedProjects"]:checked')).map(cb => cb.value);

      try {
        await createEmployeeAccount(email, password, name, assignedProjects);
        await loadAllUsers();
        showModal = null;
        showToast('Employee added successfully.');
        render();
      } catch (err) {
        errEl.textContent = firebaseErrorMessage(err);
        btn.disabled = false;
        btn.textContent = 'Add Employee';
      }
    });

    // Add client form
    document.getElementById('addClientForm')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      const btn = document.getElementById('modalSubmitBtn');
      const errEl = document.getElementById('modalError');
      btn.disabled = true;
      btn.textContent = 'Creating...';
      errEl.textContent = '';

      const fd = new FormData(this);
      const email = fd.get('email').trim().toLowerCase();
      const name = fd.get('name').trim();

      try {
        await createClientAccount(email, name);
        await loadAllUsers();
        showModal = null;
        showToast('Welcome email sent to ' + email);
        render();
      } catch (err) {
        errEl.textContent = firebaseErrorMessage(err);
        btn.disabled = false;
        btn.textContent = 'Add Client';
      }
    });

    // Edit client form
    document.getElementById('editClientForm')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('modalSubmitBtn');
      var errEl = document.getElementById('modalError');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      errEl.textContent = '';

      var fd = new FormData(this);
      var uid = fd.get('uid');
      var name = fd.get('name').trim();
      var projectId = fd.get('projectId');

      try {
        // Update Firestore user doc
        await db.collection('users').doc(uid).update({
          name: name,
          projectId: projectId || ''
        });
        // If project assigned, also update the project's clientId
        if (projectId) {
          await db.collection('projects').doc(projectId).update({
            clientId: uid
          });
        }
        await loadAllUsers();
        await loadAllProjects();
        showModal = null;
        editClientId = null;
        showToast('Client updated.');
        render();
      } catch (err) {
        errEl.textContent = firebaseErrorMessage(err);
        btn.disabled = false;
        btn.textContent = 'Save Changes';
      }
    });

    // New project form
    // ── Wizard navigation ────────────────────────────────────────
    document.getElementById('wizardNext')?.addEventListener('click', function() {
      if (!wizardState) return;
      var s = wizardState;
      var errEl = document.getElementById('modalError');
      errEl.textContent = '';

      // Collect current step data before advancing
      if (s.step === 1) {
        s.name     = (document.getElementById('wName')?.value || '').trim();
        s.location = (document.getElementById('wLocation')?.value || '').trim();
        s.clientId = document.getElementById('wClient')?.value || '';
        s.startDate      = document.getElementById('wStartDate')?.value || '';
        s.estCompletion  = document.getElementById('wEstCompletion')?.value || '';
        s.googleSheetUrl = document.getElementById('wGoogleSheet')?.value || '';
        if (!s.name) { errEl.textContent = 'Project name is required.'; return; }
      } else if (s.step === 2) {
        var pt = document.querySelector('input[name="wProjectType"]:checked');
        if (!pt) { errEl.textContent = 'Please select a project type.'; return; }
        s.project_type = pt.value;
        // ADU defaults to simple tier if not already changed by user
        if (s.project_type === 'adu' && s.tier === 'standard') s.tier = 'simple';
        // Reset remodel conditions default based on type
        s.include_remodel_conditions = (s.project_type === 'remodel' || s.project_type === 'addition');
      } else if (s.step === 3) {
        var ct = document.querySelector('input[name="wContractType"]:checked');
        s.contract_type = ct ? ct.value : 'cost_plus';
      } else if (s.step === 4) {
        var rc = document.querySelector('input[name="wRemodelCond"]:checked');
        s.include_remodel_conditions = !rc || rc.value === 'yes';
      } else if (s.step === 5) {
        var tier = document.querySelector('input[name="wTier"]:checked');
        s.tier = tier ? tier.value : 'standard';
      } else if (s.step === 6) {
        var mods = document.querySelectorAll('input[name="wModules"]:checked');
        s.modules = Array.from(mods).map(function(m) { return m.value; });
      }

      s.step = wizardNextStepNum(s.step);
      render();
    });

    document.getElementById('wizardBack')?.addEventListener('click', function() {
      if (!wizardState) return;
      wizardState.step = wizardPrevStepNum(wizardState.step);
      render();
    });

    document.getElementById('wizardCreate')?.addEventListener('click', async function() {
      if (!wizardState) return;
      var s = wizardState;
      var btn = document.getElementById('wizardCreate');
      var errEl = document.getElementById('modalError');
      btn.disabled = true;
      btn.textContent = 'Creating...';
      errEl.textContent = '';

      try {
        // Resolve client name
        var clientName = '';
        if (s.clientId) {
          var c = allUsers.find(function(u) { return u.id === s.clientId; });
          clientName = c ? c.name : '';
        }

        // Create the project document
        var projectId = await createProject({
          name:           s.name,
          location:       s.location,
          clientId:       s.clientId,
          clientName:     clientName,
          startDate:      s.startDate,
          estCompletion:  s.estCompletion,
          googleSheetUrl: s.googleSheetUrl
        });

        // Seed the budget template
        btn.textContent = 'Seeding budget...';
        var seeded = await seedProjectBudget(projectId, {
          tier:                       s.tier,
          project_type:               s.project_type,
          contract_type:              s.contract_type,
          modules:                    s.modules,
          include_remodel_conditions: s.include_remodel_conditions
        });

        await refreshAdminData();
        showModal = null;
        wizardState = null;
        showToast('Project created. ' + seeded + ' budget lines seeded.');
        render();
      } catch (err) {
        errEl.textContent = err.message;
        btn.disabled = false;
        btn.textContent = 'Create Project';
      }
    });

    // Radio/checkbox click-to-select visual update within wizard
    document.querySelectorAll('.wizard-choice input[type="radio"]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        var group = this.closest('.wizard-choices');
        if (group) {
          group.querySelectorAll('.wizard-choice').forEach(function(c) { c.classList.remove('selected'); });
          this.closest('.wizard-choice')?.classList.add('selected');
        }
      });
    });
    document.querySelectorAll('.wizard-module input[type="checkbox"]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        this.closest('.wizard-module')?.classList.toggle('selected', this.checked);
      });
    });
  }

  // ========================================
  // EMPLOYEE EVENT BINDING
  // ========================================

  function bindEmployeeEvents() {
    document.getElementById('logoutBtn')?.addEventListener('click', logout);

    // Project cards
    document.querySelectorAll('[data-emp-project-id]').forEach(card => {
      card.addEventListener('click', async () => {
        employeeSelectedProject = card.dataset.empProjectId;
        employeeView = 'detail';
        employeeDetailTab = 'updates';
        firestoreBudgetItems = [];
        projectDocuments = [];
        projectSelections = [];
        currentChangeOrders = [];
        currentInvoices = [];
        currentMessages = [];
        await loadMessages(employeeSelectedProject);
        render();
      });
    });

    // Back button
    document.getElementById('empBackBtn')?.addEventListener('click', () => {
      employeeView = 'overview';
      employeeSelectedProject = null;
      employeeDetailTab = 'updates';
      firestoreBudgetItems = [];
      projectDocuments = [];
      projectSelections = [];
      currentChangeOrders = [];
      currentInvoices = [];
      currentMessages = [];
      lightboxPhoto = null;
      render();
      // No updates events to rebind here
    });

    // Employee tab navigation
    document.querySelectorAll('[data-emp-tab]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tab = btn.dataset.empTab;
        employeeDetailTab = tab;
        if (tab === 'budget') {
          const proj = allProjects.find(p => p.id === employeeSelectedProject);
          const projHasSheet = proj && proj.googleSheetUrl && extractSheetId(proj.googleSheetUrl);
          if (projHasSheet) {
            // Sheets mode: always re-fetch live data
            budgetData = null;
            budgetFetchError = null;
            render();
            fetchBudgetData();
            return;
          } else if (firestoreBudgetItems.length === 0 && !firestoreBudgetLoading) {
            await loadBudgetItems(employeeSelectedProject);
            return;
          }
        }
        if (tab === 'updates' && currentMessages.length === 0 && !messagesLoading) {
          await loadMessages(employeeSelectedProject);
          return;
        }
        if (tab === 'documents' && projectDocuments.length === 0 && !documentsLoading) {
          await loadDocuments(employeeSelectedProject);
          return;
        }
        if (tab === 'selections' && projectSelections.length === 0 && !selectionsLoading) {
          await loadSelections(employeeSelectedProject);
          return;
        }
        if (tab === 'changeOrders' && currentChangeOrders.length === 0 && !changeOrdersLoading) {
          await loadChangeOrders(employeeSelectedProject);
          return;
        }
        if (tab === 'invoices' && currentInvoices.length === 0 && !invoicesLoading) {
          await loadInvoices(employeeSelectedProject);
          return;
        }
        render();
        if (tab === 'updates') {
          bindUpdatesEvents(employeeSelectedProject, 'employee');
        }
      });
    });

    // Employee updates events - bind if updates tab is active
    if (employeeDetailTab === 'updates') {
      bindUpdatesEvents(employeeSelectedProject, 'employee');
    }

    // Employee save phases
    document.getElementById('empSavePhaseBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('empSavePhaseBtn');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      const project = allProjects.find(p => p.id === employeeSelectedProject);
      if (!project || !project.phases) return;

      const updatedPhases = project.phases.map((phase, i) => {
        const statusSelect = document.querySelector('[data-emp-phase-status="' + i + '"]');
        return {
          ...phase,
          status: statusSelect ? statusSelect.value : phase.status
        };
      });

      try {
        await updateProject(employeeSelectedProject, { phases: updatedPhases });
        // Refresh just the local project data
        const idx = allProjects.findIndex(p => p.id === employeeSelectedProject);
        if (idx >= 0) allProjects[idx].phases = updatedPhases;
        showToast('Phase changes saved.');
        render();
      } catch (err) {
        showToast('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Save Phase Changes';
      }
    });

    // Employee document upload
    document.getElementById('empDocUploadForm')?.addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('empDocUploadBtn');
      var fileInput = this.querySelector('[name="docFile"]');
      var file = fileInput.files[0];
      if (!file) return;
      btn.disabled = true;
      btn.textContent = 'Uploading...';
      try {
        var category = this.querySelector('[name="category"]').value;
        await uploadDocument(employeeSelectedProject, file, category);
        showToast('Document uploaded.');
        await loadDocuments(employeeSelectedProject);
      } catch (err) {
        showToast('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Upload Document';
      }
    });

    // Budget category expand/collapse (read-only view)
    document.querySelectorAll('[data-budget-cat]').forEach(row => {
      row.addEventListener('click', () => {
        const catIndex = parseInt(row.dataset.budgetCat);
        budgetExpandedCategories[catIndex] = !budgetExpandedCategories[catIndex];
        const toggle = row.querySelector('.budget-category-toggle');
        if (toggle) toggle.classList.toggle('open');
        document.querySelectorAll('[data-budget-cat-child="' + catIndex + '"]').forEach(child => {
          child.classList.toggle('expanded');
        });
      });
    });

    // Phase calendar nav (employee phases tab)
    if (employeeView === 'detail' && employeeDetailTab === 'phases') {
      var empCalProject = allProjects.find(function(p) { return p.id === employeeSelectedProject; });
      if (empCalProject) bindCalendarNav(empCalProject.phases, 'employeePhases');
    }

    // Lightbox events
    bindLightboxEvents();
  }

  // ========================================
  // AUTH
  // ========================================

  async function logout() {
    try {
      await auth.signOut();
    } catch (e) {
      console.error('Logout error:', e);
    }
    currentUser = null;
    userProfile = null;
    appState = 'login';
    adminView = 'overview';
    adminSelectedProject = null;
    adminDetailTab = 'details';
    showModal = null;
    showBudgetModal = false;
    editingBudgetItem = null;
    clientView = 'dashboard';
    employeeView = 'overview';
    employeeSelectedProject = null;
    employeeDetailTab = 'updates';
    allProjects = [];
    allUsers = [];
    budgetData = null;
    firestoreBudgetItems = [];
    projectPhotos = [];
    projectDocuments = [];
    projectSelections = [];
    currentChangeOrders = [];
    currentInvoices = [];
    currentMessages = [];
    lightboxPhoto = null;
    render();
  }

  function firebaseErrorMessage(err) {
    const code = err.code || '';
    switch (code) {
      case 'auth/user-not-found': return 'No account found with this email.';
      case 'auth/wrong-password': return 'Incorrect password.';
      case 'auth/invalid-credential': return 'Invalid email or password.';
      case 'auth/email-already-in-use': return 'This email is already registered.';
      case 'auth/weak-password': return 'Password must be at least 6 characters.';
      case 'auth/invalid-email': return 'Please enter a valid email address.';
      case 'auth/too-many-requests': return 'Too many attempts. Please try again later.';
      case 'auth/network-request-failed': return 'Network error. Check your connection.';
      default: return err.message || 'An error occurred. Please try again.';
    }
  }

  async function refreshAdminData() {
    await Promise.all([loadAllProjects(), loadAllUsers(), checkQboConnection()]);
  }

  // ========================================
  // QBO HELPER FUNCTIONS
  // ========================================

  function getQboAuthUrl() {
    var clientId = PORTAL_CONFIG.qboClientId || '';
    var redirectUri = encodeURIComponent(PORTAL_CONFIG.portalUrl + '/qbo-callback.html');
    var scope = encodeURIComponent('com.intuit.quickbooks.accounting');
    var state = Math.random().toString(36).substring(2, 18);
    return 'https://appcenter.intuit.com/connect/oauth2' +
      '?client_id=' + clientId +
      '&redirect_uri=' + redirectUri +
      '&response_type=code' +
      '&scope=' + scope +
      '&state=' + state;
  }

  async function qboRequest(type, extraData) {
    var reqRef = await db.collection('_qboRequests').add(
      Object.assign({ type: type, status: 'pending', requestedAt: firebase.firestore.FieldValue.serverTimestamp() }, extraData || {})
    );

    return new Promise(function(resolve, reject) {
      var unsubscribe = reqRef.onSnapshot(function(snap) {
        var data = snap.data();
        if (data && data.status === 'complete') {
          unsubscribe();
          reqRef.delete().catch(function() {});
          resolve(data.results || []);
        } else if (data && data.status === 'error') {
          unsubscribe();
          reqRef.delete().catch(function() {});
          reject(new Error(data.error || 'Request failed'));
        }
      });
      // Timeout after 30 seconds
      setTimeout(function() { unsubscribe(); reject(new Error('Request timed out')); }, 30000);
    });
  }

  async function checkQboConnection() {
    try {
      var snap = await db.collection('settings').doc('qbo').get();
      qboConnected = snap.exists;
    } catch (e) {
      console.warn('Could not check QBO connection:', e);
      qboConnected = false;
    }
  }

  async function loadQboCustomers() {
    if (!qboConnected) return;
    try {
      var results = await qboRequest('getCustomers');
      qboCustomers = results;
      render(); // Re-render to populate customer dropdown
    } catch (e) {
      console.warn('Could not load QBO customers:', e);
      qboCustomers = [];
    }
  }

  async function syncInvoicesFromQbo(projectId) {
    var project = allProjects.find(function(p) { return p.id === projectId; });
    if (!project) return;
    var customerId = project.qboCustomerId || null;
    try {
      var qboInvoices = await qboRequest('getInvoices', customerId ? { customerId: customerId } : {});
      // Map QBO invoices to portal invoice format
      currentInvoices = qboInvoices.map(function(inv) {
        return {
          id: inv.id,
          title: inv.docNumber ? 'Invoice #' + inv.docNumber : 'Invoice',
          amount: inv.totalAmt,
          balance: inv.balance,
          status: inv.status,
          dueDate: inv.dueDate,
          txnDate: inv.txnDate,
          invoiceUrl: inv.invoiceUrl,
          customerName: inv.customerName,
          notes: '',
          fromQbo: true
        };
      });
      return { success: true, count: currentInvoices.length };
    } catch (e) {
      console.error('QBO invoice sync error:', e);
      throw e;
    }
  }

  async function disconnectQbo() {
    try {
      await qboRequest('disconnect');
      qboConnected = false;
      qboCustomers = [];
      currentInvoices = [];
    } catch (e) {
      console.error('QBO disconnect error:', e);
      throw e;
    }
  }

  // ========================================
  // AUTH STATE LISTENER
  // ========================================

  // Preserve existing session — Firebase handles auth state automatically

  auth.onAuthStateChanged(async (user) => {
    console.log('Auth state:', user ? user.email : 'no user');
    if (user) {
      currentUser = user;

      // Get user profile from Firestore
      try {
        userProfile = await getUserProfile(user.uid);

        if (!userProfile) {
          // User exists in Auth but not in Firestore — might be first admin setup completing
          // Wait a moment and retry
          await new Promise(r => setTimeout(r, 500));
          userProfile = await getUserProfile(user.uid);
        }

        if (!userProfile) {
          // Still no profile — stale auth session, sign out and let it re-check
          await auth.signOut();
          return;
        }

        if (userProfile.role === 'admin') {
          await refreshAdminData();
          appState = 'admin';
          restoreFromHash(); // restore last-viewed project/tab from URL
          // Auto-migrate existing admins: ensure settings/portal is marked initialized.
          db.collection('settings').doc('portal').set({ adminInitialized: true }, { merge: true }).catch(() => {});
          // Auto-upload cost code template if not already in Firestore
          ensureCostCodeTemplate().catch(() => {});
        } else if (userProfile.role === 'employee') {
          // Employee — load all projects, filter to assigned
          await loadAllProjects();
          const assigned = userProfile.assignedProjects || [];
          allProjects = allProjects.filter(p => assigned.indexOf(p.id) >= 0);
          appState = 'employee';
        } else {
          // Client — load their project and pre-load action items for the Home dashboard
          await loadAllProjects();
          await loadAllUsers();
          const clientPid = userProfile.projectId;
          if (clientPid) {
            await Promise.all([
              loadChangeOrders(clientPid),
              loadInvoices(clientPid),
              loadMessages(clientPid),
              loadBudgetItems(clientPid)  // needed for home page finance snapshot
            ]);
          }
          appState = 'client';
          restoreFromHash(); // restore last client tab from URL
        }

        render();
      } catch (err) {
        console.error('Error loading user data:', err);
        // Sign out stale session and check if setup is needed
        await auth.signOut();
      }
    } else {
      // No user signed in
      currentUser = null;
      userProfile = null;

      // Check if this is a fresh install (no admin created yet)
      const initialized = await checkAdminInitialized();
      appState = initialized ? 'login' : 'setup';
      render();
    }
  });

  // ========================================
  // INITIAL RENDER (loading state)
  // ========================================

  // Bind signature modal events once (static HTML in body)
  bindSignatureModalEvents();

  render();

  // Handle QBO OAuth callback URL params
  (function() {
    var urlParams = new URLSearchParams(window.location.search);
    var qboParam = urlParams.get('qbo');
    if (qboParam === 'connected') {
      // Clean up URL and show success toast after auth state resolves
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(function() {
        qboConnected = true;
        showToast('QuickBooks connected successfully!');
        render();
      }, 2000);
    } else if (qboParam === 'error') {
      var msg = urlParams.get('message') || 'QuickBooks connection failed. Please try again.';
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(function() {
        showToast('QBO Error: ' + msg);
      }, 1500);
    }
  })();

  // Timeout fallback: if Firebase auth doesn't respond within 8 seconds,
  // assume it's misconfigured and show the setup/login screen
  setTimeout(() => {
    if (appState === 'loading') {
      console.warn('Firebase auth timeout — showing login screen.');
      appState = 'login';
      render();
    }
  }, 8000);


    // Delete project function (accessible globally via window)
    window.deleteProject = async function(projectId, projectName) {
      // Show custom confirm dialog
      var overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;";
      var box = document.createElement("div");
      box.style.cssText = "background:#fff;padding:30px;border-radius:8px;max-width:400px;text-align:center;font-family:var(--font-nav);";
      box.innerHTML = '<h3 style="margin:0 0 15px;color:#333">Delete Project</h3>' +
        '<p style="margin:0 0 20px;color:#666">Are you sure you want to delete <strong>' + projectName + '</strong>? This will also delete all budget items. This cannot be undone.</p>' +
        '<div style="display:flex;gap:10px;justify-content:center">' +
        '<button id="cancelDelete" style="padding:10px 20px;background:#ccc;border:none;border-radius:4px;cursor:pointer;font-size:14px">Cancel</button>' +
        '<button id="confirmDelete" style="padding:10px 20px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px">Delete Forever</button>' +
        '</div>';
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      
      return new Promise(function(resolve) {
        document.getElementById("cancelDelete").onclick = function() {
          overlay.remove();
          resolve();
        };
        document.getElementById("confirmDelete").onclick = async function() {
          try {
            this.textContent = "Deleting...";
            this.disabled = true;
            var budgetSnap = await db.collection("projects").doc(projectId).collection("budgetItems").get();
            if (budgetSnap.size > 0) {
              var batch = db.batch();
              budgetSnap.docs.forEach(function(doc) { batch.delete(doc.ref); });
              await batch.commit();
            }
            await db.collection("projects").doc(projectId).delete();
            overlay.remove();
            location.reload();
          } catch(e) {
            overlay.remove();
            document.body.innerHTML += '<div style="position:fixed;top:20px;right:20px;background:#e74c3c;color:#fff;padding:15px;border-radius:8px;z-index:10001">Error: ' + e.message + '</div>';
          }
        };
      });
    };

  // ── Styled file upload: show filename on change ──────────────────────────
  document.addEventListener('change', function(e) {
    if (e.target.type === 'file' && e.target.closest('.styled-file-upload')) {
      var zone = e.target.closest('.styled-file-upload');
      var label = zone.querySelector('.styled-file-upload-label');
      if (e.target.files && e.target.files.length > 0) {
        label.textContent = e.target.files[0].name;
        zone.classList.add('has-file');
      } else {
        label.innerHTML = '<strong>Choose a file</strong> or drag it here';
        zone.classList.remove('has-file');
      }
    }
  });

})();
