(async function () {
  const manifestPath = window.DESIGN_PREVIEWER_MANIFEST_PATH || "./design_previewer/manifest.json";

  const titleEl = document.getElementById("appTitle");
  const descriptionEl = document.getElementById("appDescription");
  const tabsEl = document.getElementById("tabs");
  const treeEl = document.getElementById("tree");
  const previewEl = document.getElementById("preview");
  const activeTitleEl = document.getElementById("activeTitle");
  const activePathEl = document.getElementById("activePath");
  const openDirectEl = document.getElementById("openDirect");

  if (!tabsEl || !treeEl || !previewEl || !activeTitleEl || !activePathEl || !openDirectEl) {
    return;
  }

  function normalizePath(pathValue) {
    return String(pathValue || "").replace(/\\/g, "/");
  }

  let manifest;

  try {
    const response = await fetch(manifestPath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load manifest: ${response.status}`);
    }
    manifest = await response.json();
  } catch (error) {
    tabsEl.innerHTML = "";
    treeEl.innerHTML = `<div class="group"><h2>Error</h2><div class="design-btn is-active">${String(error.message || error)}</div></div>`;
    return;
  }

  const versions = Array.isArray(manifest.versions) ? manifest.versions : [];
  if (!versions.length) {
    treeEl.innerHTML = "<div class=\"group\"><h2>No designs found</h2></div>";
    return;
  }

  if (titleEl) {
    titleEl.textContent = manifest.title || "Design Previewer";
  }

  if (descriptionEl) {
    descriptionEl.textContent = manifest.description || "Discover and preview designs without leaving this page.";
  }

  let activeVersionKey = versions[0].key;
  let activePath = "";

  function firstItemForVersion(versionKey) {
    const version = versions.find((entry) => entry.key === versionKey);
    if (!version || !Array.isArray(version.groups)) {
      return null;
    }

    for (const group of version.groups) {
      if (group && Array.isArray(group.items) && group.items.length) {
        return group.items[0];
      }
    }

    return null;
  }

  function setPreview(item) {
    if (!item || !item.path) {
      return;
    }

    const normalizedPath = normalizePath(item.path);
    activePath = normalizedPath;
    activeTitleEl.textContent = item.title || normalizedPath;
    activePathEl.textContent = normalizedPath;
    openDirectEl.href = normalizedPath;
    previewEl.src = normalizedPath;
    renderTree();
  }

  function renderTabs() {
    tabsEl.innerHTML = versions.map((version) => {
      const activeClass = version.key === activeVersionKey ? "is-active" : "";
      return `<button class="tab ${activeClass}" type="button" data-tab="${version.key}">${version.label || version.key}</button>`;
    }).join("");
  }

  function renderTree() {
    const activeVersion = versions.find((entry) => entry.key === activeVersionKey);
    if (!activeVersion || !Array.isArray(activeVersion.groups)) {
      treeEl.innerHTML = "";
      return;
    }

    treeEl.innerHTML = activeVersion.groups.map((group) => {
      const items = Array.isArray(group.items) ? group.items : [];
      const itemHtml = items.map((item) => {
        const normalizedPath = normalizePath(item.path);
        const activeClass = normalizedPath === activePath ? "is-active" : "";
        const title = item.title || normalizedPath;
        return `<button class="design-btn ${activeClass}" type="button" data-path="${normalizedPath}" data-title="${title.replace(/"/g, "&quot;")}">${title}</button>`;
      }).join("");

      return `<section class="group"><h2>${group.label || "Group"}</h2>${itemHtml}</section>`;
    }).join("");
  }

  tabsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (!button) {
      return;
    }

    activeVersionKey = button.dataset.tab;
    renderTabs();

    const first = firstItemForVersion(activeVersionKey);
    if (first) {
      setPreview(first);
      return;
    }

    renderTree();
  });

  treeEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-path]");
    if (!button) {
      return;
    }

    setPreview({
      title: button.dataset.title || button.dataset.path,
      path: button.dataset.path
    });
  });

  renderTabs();
  renderTree();

  const first = firstItemForVersion(activeVersionKey);
  if (first) {
    setPreview(first);
  }
})();
