const STORAGE_KEY = "pixela-web-favorites-v1";
const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const state = {
  catalog: null,
  favorites: new Set(),
  selectedPaths: new Set(),
  entriesByPath: new Map(),
  visibleEntries: [],
  filteredDates: [],
  onlyFavorites: false,
  selectedDate: null,
  selectionMode: false,
  viewerIndex: -1,
  mp4Job: null,
  favoritesMode: "local",
  favoritesSyncAvailable: false,
};

const refs = {};
const MP4_FPS_DEFAULT = 24;
const MEDIABUNNY_VERSION = "1.42.0";
const JSZIP_VERSION = "3.10.1";
const APP_CONFIG = globalThis.PIXELA_CONFIG || {};
const FAVORITES_CONFIG = APP_CONFIG.favorites || {};

function normalizeText(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getFavoriteKey(entry) {
  return entry.drive_file_id || entry.path;
}

function buildLocalFavoritesSeed(catalog) {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return new Set(JSON.parse(saved));
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const seededKeys = (catalog.entries || [])
    .filter((entry) => entry.is_favorite_seed)
    .map((entry) => getFavoriteKey(entry));

  return new Set(seededKeys);
}

function saveFavoritesLocally() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.favorites].sort()));
}

function updateFavoritesSyncStatus(message) {
  if (refs.favoritesSyncStatus) {
    refs.favoritesSyncStatus.textContent = message;
  }
}

function buildFavoritesEndpointUrl() {
  if (!FAVORITES_CONFIG.endpoint) {
    return "";
  }

  const url = new URL(FAVORITES_CONFIG.endpoint);
  if (FAVORITES_CONFIG.apiKey) {
    url.searchParams.set("api_key", FAVORITES_CONFIG.apiKey);
  }
  return url.toString();
}

async function loadRemoteFavorites() {
  if (!FAVORITES_CONFIG.enabled || !FAVORITES_CONFIG.endpoint) {
    state.favoritesMode = "local";
    state.favoritesSyncAvailable = false;
    updateFavoritesSyncStatus("Favoritos locais do navegador.");
    return buildLocalFavoritesSeed(state.catalog);
  }

  try {
    const response = await fetch(buildFavoritesEndpointUrl(), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!payload.ok) {
      throw new Error(payload.error || "Resposta inválida do Apps Script.");
    }

    const favorites = new Set();
    for (const row of payload.favorites || []) {
      if (row.drive_file_id) {
        favorites.add(String(row.drive_file_id));
      } else if (row.path) {
        favorites.add(String(row.path));
      }
    }

    state.favoritesMode = "remote";
    state.favoritesSyncAvailable = true;
    updateFavoritesSyncStatus("Favoritos sincronizados online via Google Apps Script.");
    return favorites;
  } catch (error) {
    console.error(error);
    state.favoritesMode = "local";
    state.favoritesSyncAvailable = false;
    updateFavoritesSyncStatus("Falha ao sincronizar favoritos online. Usando favoritos locais do navegador.");
    return buildLocalFavoritesSeed(state.catalog);
  }
}

async function saveFavoriteRemotely(entry, active) {
  const endpoint = buildFavoritesEndpointUrl();
  if (!state.favoritesSyncAvailable || !endpoint) {
    return;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      drive_file_id: entry.drive_file_id || "",
      path: entry.path || "",
      active,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.error || "Falha ao salvar favorito remoto.");
  }
}

function getCurrentFilters() {
  return {
    search: normalizeText(refs.searchInput.value),
    palette: refs.paletteSelect.value,
    dither: refs.ditherSelect.value,
  };
}

function entryMatchesSearch(entry, search) {
  if (!search) {
    return true;
  }

  const haystack = [
    entry.filename,
    entry.title,
    entry.palette,
    entry.dither,
    entry.id,
    entry.folder_name,
    entry.date_br,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(search);
}

function computeVisibleEntries() {
  const { search, palette, dither } = getCurrentFilters();
  const visible = state.catalog.entries.filter((entry) => {
    if (palette !== "Todas" && entry.palette !== palette) {
      return false;
    }
    if (dither !== "Todos" && entry.dither !== dither) {
      return false;
    }
    if (state.onlyFavorites && !state.favorites.has(getFavoriteKey(entry))) {
      return false;
    }
    if (state.selectedDate && entry.date_iso !== state.selectedDate) {
      return false;
    }
    return entryMatchesSearch(entry, search);
  });

  state.visibleEntries = visible;
  state.filteredDates = [...new Set(visible.map((entry) => entry.date_iso))];
  state.selectedPaths = new Set(
    [...state.selectedPaths].filter((path) => visible.some((entry) => entry.path === path)),
  );
}

function updateStatus() {
  const selectedCount = [...state.selectedPaths].filter((path) =>
    state.visibleEntries.some((entry) => entry.path === path),
  ).length;
  const favoriteCount = state.visibleEntries.filter((entry) => state.favorites.has(getFavoriteKey(entry))).length;

  refs.statusText.textContent = state.filteredDates.length
    ? `${state.filteredDates.length} data(s), ${state.visibleEntries.length} imagem(ns), ${favoriteCount} favorita(s), ${selectedCount} selecionada(s).`
    : "Nenhuma data encontrada para os filtros atuais.";

  refs.heroCount.textContent = `${state.catalog.entries.length} imagens indexadas`;
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function formatIsoDateToBr(iso) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function estimateBitrate(width, height, fps, quality) {
  const pixelRate = width * height * fps;
  const multiplier =
    quality === "compact" ? 0.09 :
    quality === "high" ? 0.24 :
    0.15;
  return Math.max(1_800_000, Math.min(14_000_000, Math.round(pixelRate * multiplier)));
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0s";
  }

  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainder}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainder}s`;
  }
  return `${remainder}s`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function compareEntriesChronologically(a, b) {
  if (a.date_iso !== b.date_iso) {
    return a.date_iso.localeCompare(b.date_iso);
  }
  const idDiff = Number(a.id) - Number(b.id);
  if (!Number.isNaN(idDiff) && idDiff !== 0) {
    return idDiff;
  }
  return a.filename.localeCompare(b.filename);
}

function getMonthRangeFromSelectors() {
  const month = Number(refs.monthSelect.value);
  const year = Number(refs.yearSelect.value);
  const monthDates = state.catalog.dates.filter((iso) => {
    const date = new Date(`${iso}T00:00:00`);
    return date.getFullYear() === year && date.getMonth() === month;
  });

  return monthDates.length
    ? { start: monthDates[0], end: monthDates[monthDates.length - 1] }
    : null;
}

function getMp4Range() {
  const preset = refs.mp4Preset.value;

  if (preset === "visible") {
    return { entries: [...state.visibleEntries], label: "itens visíveis" };
  }

  if (preset === "selected-date" && state.selectedDate) {
    return {
      start: state.selectedDate,
      end: state.selectedDate,
      label: `dia ${formatIsoDateToBr(state.selectedDate)}`,
    };
  }

  if (preset === "month") {
    const monthRange = getMonthRangeFromSelectors();
    if (monthRange) {
      return {
        start: monthRange.start,
        end: monthRange.end,
        label: `mês ${refs.monthSelect.options[refs.monthSelect.selectedIndex].text}/${refs.yearSelect.value}`,
      };
    }
  }

  if (preset === "all") {
    return {
      start: state.catalog.dates[0],
      end: state.catalog.dates[state.catalog.dates.length - 1],
      label: "biblioteca inteira",
    };
  }

  return {
    start: refs.mp4StartDate.value,
    end: refs.mp4EndDate.value,
    label: "intervalo manual",
  };
}

function getMp4Entries() {
  const range = getMp4Range();
  let entries = range.entries
    ? [...range.entries]
    : state.catalog.entries.filter((entry) => entry.date_iso >= range.start && entry.date_iso <= range.end);

  if (refs.mp4OnlyFavorites.checked) {
    entries = entries.filter((entry) => state.favorites.has(getFavoriteKey(entry)));
  }

  entries.sort(compareEntriesChronologically);
  if (refs.mp4Order.value === "desc") {
    entries.reverse();
  }

  return { entries, label: range.label };
}

function populateMp4DateOptions() {
  const options = state.catalog.dates.map((iso) => createOption(iso, formatIsoDateToBr(iso)));
  refs.mp4StartDate.replaceChildren(...options.map((option) => option.cloneNode(true)));
  refs.mp4EndDate.replaceChildren(...options.map((option) => option.cloneNode(true)));
  refs.downloadStartDate.replaceChildren(...options.map((option) => option.cloneNode(true)));
  refs.downloadEndDate.replaceChildren(...options.map((option) => option.cloneNode(true)));

  refs.mp4StartDate.value = state.catalog.dates[0];
  refs.mp4EndDate.value = state.catalog.dates[state.catalog.dates.length - 1];
  refs.downloadStartDate.value = state.catalog.dates[0];
  refs.downloadEndDate.value = state.catalog.dates[state.catalog.dates.length - 1];
}

function updateMp4Summary() {
  if (!refs.mp4Summary) {
    return;
  }

  const { entries, label } = getMp4Entries();
  const fps = Number(refs.mp4Fps.value || MP4_FPS_DEFAULT);
  const framesPerImage = Number(refs.mp4Frames.value || 2);
  const secondsPerImage = framesPerImage / fps;
  const totalDuration = entries.length * secondsPerImage;

  refs.mp4Summary.textContent = entries.length
    ? `${entries.length} imagem(ns) de ${label} • duração estimada ${formatDuration(totalDuration)}`
    : "Nenhuma imagem disponível para o exportador com as opções atuais.";

  if (!("VideoEncoder" in window)) {
    refs.mp4Status.textContent = "Este navegador não oferece WebCodecs, então a exportação MP4 longa não deve funcionar aqui.";
    return;
  }

  if ("showSaveFilePicker" in window) {
    refs.mp4Status.textContent = "Modo recomendado ativo: gravação em arquivo durante o processamento, melhor para vídeos grandes.";
  } else {
    refs.mp4Status.textContent = "Fallback ativo: o navegador vai montar o MP4 em memória antes do download. Para vídeos longos, prefira Chrome ou Edge.";
  }
}

async function loadMp4Lib() {
  if (globalThis.__pixelaMediabunny) {
    return globalThis.__pixelaMediabunny;
  }

  const module = await import(`https://esm.sh/mediabunny@${MEDIABUNNY_VERSION}`);
  globalThis.__pixelaMediabunny = module;
  return module;
}

async function loadZipLib() {
  if (globalThis.__pixelaJsZip) {
    return globalThis.__pixelaJsZip;
  }

  const module = await import(`https://esm.sh/jszip@${JSZIP_VERSION}`);
  globalThis.__pixelaJsZip = module.default;
  return module.default;
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function fetchImageBlob(entry, signal) {
  const response = await fetch(entry.url, { signal, cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Falha ao baixar ${entry.filename}: ${response.status}`);
  }
  return response.blob();
}

async function downloadEntry(entry) {
  const blob = await fetchImageBlob(entry);
  triggerBlobDownload(blob, entry.filename);
}

async function downloadSelectedAsZip() {
  const entries = [...state.selectedPaths]
    .map((path) => state.entriesByPath.get(path))
    .filter(Boolean)
    .sort(compareEntriesChronologically);

  if (!entries.length) {
    refs.statusText.textContent = "Selecione pelo menos uma imagem para baixar em lote.";
    return;
  }

  const JSZip = await loadZipLib();
  const zip = new JSZip();
  refs.statusText.textContent = `Preparando download de ${entries.length} imagem(ns) selecionada(s)...`;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const blob = await fetchImageBlob(entry);
    zip.file(`${entry.folder_name}/${entry.filename}`, blob);
    refs.statusText.textContent = `Compactando selecionadas... ${index + 1}/${entries.length}`;
  }

  const archive = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const first = entries[0];
  const last = entries[entries.length - 1];
  const fileName = `Pixela selecionadas - ${first.folder_name} a ${last.folder_name}.zip`;
  triggerBlobDownload(archive, fileName);
  refs.statusText.textContent = `${entries.length} imagem(ns) selecionada(s) baixadas em .zip.`;
}

function getDateRangeDownloadEntries() {
  const start = refs.downloadStartDate.value;
  const end = refs.downloadEndDate.value;
  let entries = state.catalog.entries.filter((entry) => entry.date_iso >= start && entry.date_iso <= end);

  if (refs.downloadOnlyFavorites.checked) {
    entries = entries.filter((entry) => state.favorites.has(getFavoriteKey(entry)));
  }

  entries.sort(compareEntriesChronologically);
  return { entries, start, end };
}

function updateDateRangeDownloadSummary() {
  const { entries, start, end } = getDateRangeDownloadEntries();
  const startBr = start ? formatIsoDateToBr(start) : "-";
  const endBr = end ? formatIsoDateToBr(end) : "-";

  refs.downloadRangeSummary.textContent = entries.length
    ? `${entries.length} imagem(ns) entre ${startBr} e ${endBr}`
    : `Nenhuma imagem entre ${startBr} e ${endBr} com os filtros desta seção.`;
}

async function downloadDateRangeAsZip() {
  const { entries, start, end } = getDateRangeDownloadEntries();
  if (!entries.length) {
    refs.downloadRangeStatus.textContent = "Não há imagens para baixar nesse intervalo.";
    return;
  }

  const JSZip = await loadZipLib();
  const zip = new JSZip();
  refs.downloadRangeStatus.textContent = `Preparando intervalo ${formatIsoDateToBr(start)} até ${formatIsoDateToBr(end)}...`;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const blob = await fetchImageBlob(entry);
    zip.file(`${entry.folder_name}/${entry.filename}`, blob);
    refs.downloadRangeStatus.textContent = `Compactando intervalo... ${index + 1}/${entries.length}`;
  }

  const archive = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const suffix = refs.downloadOnlyFavorites.checked ? " - favoritas" : "";
  triggerBlobDownload(archive, `Pixela - ${start} a ${end}${suffix}.zip`);
  refs.downloadRangeStatus.textContent = `${entries.length} imagem(ns) baixadas do intervalo em .zip.`;
}

async function loadBitmap(url, signal) {
  const response = await fetch(url, { signal, cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Falha ao baixar imagem: ${response.status}`);
  }

  const blob = await response.blob();
  return createImageBitmap(blob);
}

function drawBitmapToCanvas(ctx, bitmap, width, height) {
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const drawWidth = Math.max(1, Math.round(bitmap.width * scale));
  const drawHeight = Math.max(1, Math.round(bitmap.height * scale));
  const offsetX = Math.floor((width - drawWidth) / 2);
  const offsetY = Math.floor((height - drawHeight) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, offsetX, offsetY, drawWidth, drawHeight);
  ctx.restore();
}

async function chooseMp4Target(fileName, MediaBunny) {
  if ("showSaveFilePicker" in window) {
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [
        {
          description: "Vídeo MP4",
          accept: { "video/mp4": [".mp4"] },
        },
      ],
    });
    const writable = await fileHandle.createWritable();

    return {
      mode: "stream",
      target: new MediaBunny.StreamTarget(writable),
      finalize: async () => {},
    };
  }

  return {
    mode: "buffer",
    target: new MediaBunny.BufferTarget(),
    finalize: async (output) => {
      const blob = new Blob([output.target.buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
  };
}

function getMp4FileName(entries) {
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (!first || !last) {
    return "pixela-export.mp4";
  }
  return `Pixela - ${first.folder_name} to ${last.folder_name}.mp4`;
}

async function generateMp4() {
  if (state.mp4Job) {
    return;
  }

  const { entries } = getMp4Entries();
  if (!entries.length) {
    refs.mp4Status.textContent = "Não há imagens para exportar com as opções atuais.";
    return;
  }

  if (!("VideoEncoder" in window)) {
    refs.mp4Status.textContent = "Sem WebCodecs neste navegador. O exportador MP4 pensado para lotes grandes precisa desse suporte.";
    return;
  }

  const abortController = new AbortController();
  state.mp4Job = { abortController };
  refs.mp4Generate.disabled = true;
  refs.mp4Cancel.disabled = false;

  try {
    const MediaBunny = await loadMp4Lib();
    const fps = Number(refs.mp4Fps.value || MP4_FPS_DEFAULT);
    const framesPerImage = Number(refs.mp4Frames.value || 2);
    const scale = Number(refs.mp4Scale.value || 1);
    const quality = refs.mp4Quality.value;
    const fileName = getMp4FileName(entries);

    refs.mp4Status.textContent = "Lendo a primeira imagem para definir a resolução do vídeo...";
    const firstBitmap = await loadBitmap(entries[0].url, abortController.signal);
    const baseWidth = Math.max(2, Math.round(firstBitmap.width * scale));
    const baseHeight = Math.max(2, Math.round(firstBitmap.height * scale));
    const bitrate = estimateBitrate(baseWidth, baseHeight, fps, quality);
    const totalFrames = entries.length;

    const canvas = document.createElement("canvas");
    canvas.width = baseWidth;
    canvas.height = baseHeight;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("Não foi possível criar o contexto do canvas.");
    }

    const targetBundle = await chooseMp4Target(fileName, MediaBunny);
    const output = new MediaBunny.Output({
      format: new MediaBunny.Mp4OutputFormat({
        fastStart: targetBundle.mode === "stream" ? "reserve" : false,
      }),
      target: targetBundle.target,
    });

    const source = new MediaBunny.CanvasSource(canvas, {
      codec: "avc",
      bitrate,
    });

    output.addVideoTrack(source, {
      frameRate: fps,
      maximumPacketCount: totalFrames,
    });

    await output.start();

    let timestamp = 0;
    const frameDuration = framesPerImage / fps;

    for (let index = 0; index < entries.length; index += 1) {
      abortController.signal.throwIfAborted();
      const entry = entries[index];
      const bitmap = index === 0 ? firstBitmap : await loadBitmap(entry.url, abortController.signal);

      try {
        drawBitmapToCanvas(ctx, bitmap, baseWidth, baseHeight);
        await source.add(timestamp, frameDuration);
      } finally {
        bitmap.close();
      }

      timestamp += frameDuration;

      if ((index + 1) % 5 === 0 || index === entries.length - 1) {
        const progress = `${index + 1}/${entries.length}`;
        refs.mp4Status.textContent = `Gerando MP4... ${progress} imagens processadas • duração ${formatDuration(timestamp)}`;
      }
    }

    source.close();
    refs.mp4Status.textContent = "Finalizando MP4...";
    await output.finalize();
    await targetBundle.finalize(output);

    const estimatedSize = (bitrate / 8) * timestamp;
    refs.mp4Status.textContent = `MP4 pronto. Resolução ${baseWidth}x${baseHeight}, duração ${formatDuration(timestamp)}, tamanho estimado ${formatBytes(estimatedSize)}.`;
  } catch (error) {
    if (error?.name === "AbortError") {
      refs.mp4Status.textContent = "Exportação cancelada.";
    } else {
      console.error(error);
      refs.mp4Status.textContent = `Falha ao gerar MP4: ${error.message ?? error}`;
    }
  } finally {
    state.mp4Job = null;
    refs.mp4Generate.disabled = false;
    refs.mp4Cancel.disabled = true;
  }
}

function populateStaticFilters() {
  refs.paletteSelect.replaceChildren(createOption("Todas", "Todas"));
  refs.ditherSelect.replaceChildren(createOption("Todos", "Todos"));

  for (const palette of state.catalog.palettes) {
    refs.paletteSelect.append(createOption(palette, palette));
  }

  for (const dither of state.catalog.dithers) {
    refs.ditherSelect.append(createOption(dither, dither));
  }

  const years = [...new Set(state.catalog.dates.map((date) => Number(date.slice(0, 4))))];
  const lastDate = state.catalog.dates.at(-1);
  const initialMonth = lastDate ? Number(lastDate.slice(5, 7)) - 1 : 0;
  const initialYear = lastDate ? Number(lastDate.slice(0, 4)) : years[0];

  refs.monthSelect.replaceChildren(
    ...MONTH_NAMES.map((month, index) => createOption(String(index), month)),
  );
  refs.yearSelect.replaceChildren(
    ...years.map((year) => createOption(String(year), String(year))),
  );

  refs.monthSelect.value = String(initialMonth);
  refs.yearSelect.value = String(initialYear);
  populateMp4DateOptions();
  updateMp4Summary();
}

function renderCalendar() {
  const month = Number(refs.monthSelect.value);
  const year = Number(refs.yearSelect.value);
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const datesSet = new Set(state.catalog.dates);

  const cells = [];

  for (let i = 0; i < startWeekday; i += 1) {
    const filler = document.createElement("button");
    filler.className = "calendar-day is-empty";
    filler.type = "button";
    filler.disabled = true;
    cells.push(filler);
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = new Date(year, month, day);
    const iso = date.toISOString().slice(0, 10);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.innerHTML = `<span class="day-inner">${day}</span>`;

    if (datesSet.has(iso)) {
      button.classList.add("has-entries");
      button.addEventListener("click", () => {
        state.selectedDate = state.selectedDate === iso ? null : iso;
        applyFilters();
      });
    } else {
      button.disabled = true;
    }

    if (state.selectedDate === iso) {
      button.classList.add("is-selected");
    }

    cells.push(button);
  }

  refs.calendarGrid.replaceChildren(...cells);
  updateMp4Summary();
}

function createCard(entry) {
  const card = document.createElement("article");
  card.className = "card";
  if (state.selectedPaths.has(entry.path)) {
    card.classList.add("is-selected");
  }

  const favoriteButton = document.createElement("button");
  favoriteButton.type = "button";
  favoriteButton.className = "star-button";
  favoriteButton.textContent = state.favorites.has(getFavoriteKey(entry)) ? "★" : "☆";
  if (state.favorites.has(getFavoriteKey(entry))) {
    favoriteButton.classList.add("is-favorite");
  }
  favoriteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(entry);
  });

  const thumbButton = document.createElement("button");
  thumbButton.type = "button";
  thumbButton.className = "thumb-button";
  thumbButton.addEventListener("click", () => {
    if (state.selectionMode) {
      toggleSelection(entry.path);
      return;
    }
    openViewer(entry.path);
  });

  const image = document.createElement("img");
  image.className = "thumb";
  image.src = entry.thumbnail_url || entry.url;
  image.alt = entry.filename;
  image.loading = "lazy";
  image.decoding = "async";
  thumbButton.append(image);

  const title = document.createElement("p");
  title.className = "card-title";
  title.textContent = entry.title;

  const meta = document.createElement("p");
  meta.className = "card-meta";
  meta.textContent = `${entry.date_br} | ${entry.palette} | ${entry.dither}`;

  const file = document.createElement("p");
  file.className = "card-file";
  file.textContent = entry.filename;

  card.append(favoriteButton, thumbButton, title, meta, file);
  return card;
}

function renderGallery() {
  refs.galleryRoot.innerHTML = "";

  if (!state.filteredDates.length) {
    refs.galleryEmpty.hidden = false;
    return;
  }

  refs.galleryEmpty.hidden = true;

  const fragment = document.createDocumentFragment();

  for (const dateIso of state.filteredDates) {
    const entries = state.visibleEntries.filter((entry) => entry.date_iso === dateIso);
    const section = document.createElement("section");
    section.className = "date-section";

    const header = document.createElement("div");
    header.className = "date-header";
    header.innerHTML = `<h3>${entries[0].date_br}</h3><p>${entries.length} imagem(ns)</p>`;

    const grid = document.createElement("div");
    grid.className = "cards-grid";

    for (const entry of entries) {
      grid.append(createCard(entry));
    }

    section.append(header, grid);
    fragment.append(section);
  }

  refs.galleryRoot.append(fragment);
}

async function toggleFavorite(entry) {
  const key = getFavoriteKey(entry);
  const nextActive = !state.favorites.has(key);

  if (nextActive) {
    state.favorites.add(key);
  } else {
    state.favorites.delete(key);
  }

  saveFavoritesLocally();
  applyFilters(false);
  syncViewerFavoriteButton();

  try {
    await saveFavoriteRemotely(entry, nextActive);
  } catch (error) {
    console.error(error);
    if (nextActive) {
      state.favorites.delete(key);
    } else {
      state.favorites.add(key);
    }
    saveFavoritesLocally();
    applyFilters(false);
    syncViewerFavoriteButton();
    updateFavoritesSyncStatus("Falha ao salvar favorito online. A alteração foi revertida.");
  }
}

async function toggleFavoriteTo(entry, shouldBeFavorite) {
  const key = getFavoriteKey(entry);
  const isFavorite = state.favorites.has(key);
  if (isFavorite === shouldBeFavorite) {
    return;
  }
  await toggleFavorite(entry);
}

function toggleSelection(path) {
  if (state.selectedPaths.has(path)) {
    state.selectedPaths.delete(path);
  } else {
    state.selectedPaths.add(path);
  }

  applyFilters(false);
}

function favoriteSelected(addFavorite) {
  const entries = [...state.selectedPaths]
    .map((path) => state.entriesByPath.get(path))
    .filter(Boolean);

  Promise.all(entries.map((entry) => toggleFavoriteTo(entry, addFavorite))).catch((error) => {
    console.error(error);
  });
}

function applyFilters(renderCalendarToo = true) {
  computeVisibleEntries();
  updateStatus();
  renderGallery();
  if (renderCalendarToo) {
    renderCalendar();
  }
  updateMp4Summary();
}

function getViewerEntry() {
  return state.visibleEntries[state.viewerIndex] ?? null;
}

function syncViewerFavoriteButton() {
  const entry = getViewerEntry();
  if (!entry) {
    return;
  }

  const isFavorite = state.favorites.has(getFavoriteKey(entry));
  refs.viewerFavorite.textContent = isFavorite ? "Desfavoritar" : "Favoritar";
}

function updateViewer() {
  const entry = getViewerEntry();
  if (!entry) {
    refs.viewer.close();
    return;
  }

  refs.viewerImage.src = entry.url;
  refs.viewerImage.alt = entry.filename;
  refs.viewerTitle.textContent = entry.filename;
  refs.viewerMeta.textContent = `${entry.date_br} | ${entry.palette} | ${entry.dither} | ${state.viewerIndex + 1}/${state.visibleEntries.length}`;
  refs.viewerOpen.href = entry.viewer_url || entry.url;
  refs.viewerDownload.disabled = false;
  syncViewerFavoriteButton();
}

function openViewer(path) {
  const index = state.visibleEntries.findIndex((entry) => entry.path === path);
  if (index < 0) {
    return;
  }

  state.viewerIndex = index;
  updateViewer();
  refs.viewer.showModal();
}

function moveViewer(step) {
  if (!state.visibleEntries.length) {
    return;
  }

  state.viewerIndex = (state.viewerIndex + step + state.visibleEntries.length) % state.visibleEntries.length;
  updateViewer();
}

function bindEvents() {
  refs.searchInput.addEventListener("input", () => applyFilters());
  refs.paletteSelect.addEventListener("change", () => applyFilters());
  refs.ditherSelect.addEventListener("change", () => applyFilters());
  refs.monthSelect.addEventListener("change", renderCalendar);
  refs.yearSelect.addEventListener("change", renderCalendar);
  refs.clearDate.addEventListener("click", () => {
    state.selectedDate = null;
    applyFilters();
  });
  refs.favoritesFilter.addEventListener("click", () => {
    state.onlyFavorites = !state.onlyFavorites;
    refs.favoritesFilter.classList.toggle("is-active", state.onlyFavorites);
    refs.favoritesFilter.textContent = `Só Favoritas: ${state.onlyFavorites ? "ON" : "OFF"}`;
    applyFilters(false);
  });
  refs.selectionMode.addEventListener("change", () => {
    state.selectionMode = refs.selectionMode.checked;
  });
  refs.favoriteSelected.addEventListener("click", () => favoriteSelected(true));
  refs.unfavoriteSelected.addEventListener("click", () => favoriteSelected(false));
  refs.downloadSelected.addEventListener("click", async () => {
    try {
      await downloadSelectedAsZip();
    } catch (error) {
      console.error(error);
      refs.statusText.textContent = `Falha no download em lote: ${error.message ?? error}`;
    }
  });
  refs.clearSelection.addEventListener("click", () => {
    state.selectedPaths.clear();
    applyFilters(false);
  });
  refs.clearFilters.addEventListener("click", () => {
    refs.searchInput.value = "";
    refs.paletteSelect.value = "Todas";
    refs.ditherSelect.value = "Todos";
    state.onlyFavorites = false;
    state.selectedDate = null;
    refs.favoritesFilter.classList.remove("is-active");
    refs.favoritesFilter.textContent = "Só Favoritas: OFF";
    applyFilters();
  });
  refs.thumbSize.addEventListener("input", () => {
    document.documentElement.style.setProperty("--thumb-size", `${refs.thumbSize.value}px`);
    refs.thumbSizeLabel.textContent = `${refs.thumbSize.value} px`;
  });
  refs.downloadStartDate.addEventListener("change", updateDateRangeDownloadSummary);
  refs.downloadEndDate.addEventListener("change", updateDateRangeDownloadSummary);
  refs.downloadOnlyFavorites.addEventListener("change", updateDateRangeDownloadSummary);
  refs.downloadDateRange.addEventListener("click", async () => {
    try {
      await downloadDateRangeAsZip();
    } catch (error) {
      console.error(error);
      refs.downloadRangeStatus.textContent = `Falha no download por intervalo: ${error.message ?? error}`;
    }
  });
  refs.mp4Preset.addEventListener("change", updateMp4Summary);
  refs.mp4StartDate.addEventListener("change", updateMp4Summary);
  refs.mp4EndDate.addEventListener("change", updateMp4Summary);
  refs.mp4Order.addEventListener("change", updateMp4Summary);
  refs.mp4Frames.addEventListener("change", updateMp4Summary);
  refs.mp4Fps.addEventListener("change", updateMp4Summary);
  refs.mp4Scale.addEventListener("change", updateMp4Summary);
  refs.mp4Quality.addEventListener("change", updateMp4Summary);
  refs.mp4OnlyFavorites.addEventListener("change", updateMp4Summary);
  refs.mp4Generate.addEventListener("click", generateMp4);
  refs.mp4Cancel.addEventListener("click", () => {
    state.mp4Job?.abortController.abort();
  });

  refs.viewerClose.addEventListener("click", () => refs.viewer.close());
  refs.viewerPrev.addEventListener("click", () => moveViewer(-1));
  refs.viewerNext.addEventListener("click", () => moveViewer(1));
  refs.viewerFavorite.addEventListener("click", () => {
    const entry = getViewerEntry();
    if (entry) {
      toggleFavorite(entry);
    }
  });
  refs.viewerDownload.addEventListener("click", async () => {
    const entry = getViewerEntry();
    if (!entry) {
      return;
    }

    try {
      refs.viewerDownload.disabled = true;
      await downloadEntry(entry);
      refs.viewerDownload.disabled = false;
    } catch (error) {
      refs.viewerDownload.disabled = false;
      console.error(error);
      refs.viewerMeta.textContent = `Falha ao baixar imagem: ${error.message ?? error}`;
    }
  });
  refs.viewer.addEventListener("click", (event) => {
    const rect = refs.viewer.getBoundingClientRect();
    const isInDialog =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;
    if (!isInDialog) {
      refs.viewer.close();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (!refs.viewer.open) {
      return;
    }

    if (event.key === "ArrowLeft") {
      moveViewer(-1);
    } else if (event.key === "ArrowRight") {
      moveViewer(1);
    } else if (event.key.toLowerCase() === "f") {
      const entry = getViewerEntry();
      if (entry) {
        toggleFavorite(entry);
      }
    } else if (event.key === "Escape") {
      refs.viewer.close();
    }
  });
}

function cacheRefs() {
  refs.searchInput = document.querySelector("#search-input");
  refs.paletteSelect = document.querySelector("#palette-select");
  refs.ditherSelect = document.querySelector("#dither-select");
  refs.thumbSize = document.querySelector("#thumb-size");
  refs.thumbSizeLabel = document.querySelector("#thumb-size-label");
  refs.favoritesFilter = document.querySelector("#favorites-filter");
  refs.selectionMode = document.querySelector("#selection-mode");
  refs.favoriteSelected = document.querySelector("#favorite-selected");
  refs.unfavoriteSelected = document.querySelector("#unfavorite-selected");
  refs.downloadSelected = document.querySelector("#download-selected");
  refs.clearSelection = document.querySelector("#clear-selection");
  refs.clearFilters = document.querySelector("#clear-filters");
  refs.favoritesSyncStatus = document.querySelector("#favorites-sync-status");
  refs.monthSelect = document.querySelector("#month-select");
  refs.yearSelect = document.querySelector("#year-select");
  refs.clearDate = document.querySelector("#clear-date");
  refs.calendarGrid = document.querySelector("#calendar-grid");
  refs.statusText = document.querySelector("#status-text");
  refs.heroCount = document.querySelector("#hero-count");
  refs.galleryRoot = document.querySelector("#gallery-root");
  refs.galleryEmpty = document.querySelector("#gallery-empty");
  refs.mp4Preset = document.querySelector("#mp4-preset");
  refs.mp4StartDate = document.querySelector("#mp4-start-date");
  refs.mp4EndDate = document.querySelector("#mp4-end-date");
  refs.mp4Order = document.querySelector("#mp4-order");
  refs.mp4Frames = document.querySelector("#mp4-frames");
  refs.mp4Fps = document.querySelector("#mp4-fps");
  refs.mp4Scale = document.querySelector("#mp4-scale");
  refs.mp4Quality = document.querySelector("#mp4-quality");
  refs.mp4OnlyFavorites = document.querySelector("#mp4-only-favorites");
  refs.mp4Generate = document.querySelector("#mp4-generate");
  refs.mp4Cancel = document.querySelector("#mp4-cancel");
  refs.mp4Summary = document.querySelector("#mp4-summary");
  refs.mp4Status = document.querySelector("#mp4-status");
  refs.downloadStartDate = document.querySelector("#download-start-date");
  refs.downloadEndDate = document.querySelector("#download-end-date");
  refs.downloadOnlyFavorites = document.querySelector("#download-only-favorites");
  refs.downloadDateRange = document.querySelector("#download-date-range");
  refs.downloadRangeSummary = document.querySelector("#download-range-summary");
  refs.downloadRangeStatus = document.querySelector("#download-range-status");
  refs.viewer = document.querySelector("#viewer");
  refs.viewerClose = document.querySelector("#viewer-close");
  refs.viewerImage = document.querySelector("#viewer-image");
  refs.viewerTitle = document.querySelector("#viewer-title");
  refs.viewerMeta = document.querySelector("#viewer-meta");
  refs.viewerFavorite = document.querySelector("#viewer-favorite");
  refs.viewerDownload = document.querySelector("#viewer-download");
  refs.viewerOpen = document.querySelector("#viewer-open");
  refs.viewerPrev = document.querySelector("#viewer-prev");
  refs.viewerNext = document.querySelector("#viewer-next");
}

async function init() {
  cacheRefs();
  document.documentElement.style.setProperty("--thumb-size", `${refs.thumbSize.value}px`);
  refs.thumbSizeLabel.textContent = `${refs.thumbSize.value} px`;

  const response = await fetch("./catalogo.json");
  state.catalog = await response.json();
  state.entriesByPath = new Map(state.catalog.entries.map((entry) => [entry.path, entry]));
  state.favorites = await loadRemoteFavorites();
  saveFavoritesLocally();

  populateStaticFilters();
  bindEvents();
  applyFilters();
  updateDateRangeDownloadSummary();
}

init().catch((error) => {
  console.error(error);
  document.querySelector("#status-text").textContent =
    "Não foi possível carregar o catálogo. Rode um servidor local e gere o catalogo.json.";
});
