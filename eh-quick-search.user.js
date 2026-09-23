// ==UserScript==
// @name         E-Hentai / ExHentai 快速搜索标签
// @namespace    https://github.com/FooIbar/EhViewer
// @version      1.7.1
// @description  在网页搜索框下使用、翻译、编辑、导入和导出 EhViewer QUICK_SEARCH 标签
// @author       Codex
// @match        https://e-hentai.org/*
// @match        https://exhentai.org/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/sql-asm.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      ehtt.fly.dev
// @connect      api.github.com
// @connect      fastly.jsdelivr.net
// @connect      gcore.jsdelivr.net
// @connect      cdn.jsdelivr.net
// @connect      testingcf.jsdelivr.net
// @connect      test1.jsdelivr.net
// @connect      originfastly.jsdelivr.net
// @connect      cdn.statically.io
// @connect      rawcdn.githack.com
// @run-at       document-idle
// ==/UserScript==

(async function () {
    'use strict';

    const STORAGE_KEY = 'ehviewer-quick-search-v1';
    const COLLAPSED_KEY = 'ehviewer-quick-search-collapsed-v1';
    const WNACG_KEY = 'ehviewer-quick-search-wnacg-v1';
    const TRANSLATION_KEY = 'ehviewer-quick-search-translation-v1';
    const GROUP_SETTINGS_KEY = 'ehviewer-quick-search-groups-v1';
    const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
    const ALL_CATEGORIES = 1023;
    const GROUPS = [
        ['艺术家', ['a', 'artist']], ['团队', ['g', 'group']], ['原作', ['p', 'parody']],
        ['角色', ['c', 'character']], ['Coser', ['cos', 'cosplayer']],
        ['女性', ['f', 'female']], ['男性', ['m', 'male']], ['混合', ['x', 'mixed']],
        ['语言', ['l', 'language']], ['其他标签', ['o', 'other']],
        ['地点', ['loc', 'location']], ['重新分类', ['r', 'reclass']]
    ];
    const NAMESPACE_GROUPS = Object.fromEntries(GROUPS.flatMap(([name, aliases]) => aliases.map(alias => [alias, name])));
    const DEFAULT_GROUP_ORDER = ['语言', ...GROUPS.slice(3).map(([name]) => name).filter(name => name !== '语言'),
        '上传者', '订阅', '热门', '排行', '普通搜索', ...GROUPS.slice(0, 3).map(([name]) => name)];
    const DEFAULT_CLOSED_GROUPS = ['艺术家', '团队', '原作'];
    let groupSettings = normalizeGroupSettings(GM_getValue(GROUP_SETTINGS_KEY, null));
    const groupOpen = new Map();
    const managerGroupOpen = new Map();
    if (/^\/g\/\d+\/[a-f0-9]+\/?$/i.test(location.pathname)) addGalleryWnacgLink();
    const input = document.querySelector('input[name="f_search"], #f_search');
    if (!input || document.querySelector('#ehqs-root')) return;

    const form = input.closest('form') || input.parentElement;
    let tags = normalizeList(GM_getValue(STORAGE_KEY, []));
    let translation = normalizeTranslation(GM_getValue(TRANSLATION_KEY, null));
    let wnacgMode = Boolean(GM_getValue(WNACG_KEY, false));
    let translationUpdating = false;
    let editingIndex = -1;

    GM_addStyle(`
        #ehqs-root { box-sizing:border-box; width:min(980px,calc(100% - 12px)); margin:7px auto 1px;
            padding:4px 6px; border:1px solid #b5a69a; border-radius:4px; background:rgba(255,255,255,.10);
            font:12px/1.5 Arial,sans-serif; color:inherit; }
        #ehqs-root * { box-sizing:border-box; }
        #ehqs-head { display:flex; align-items:center; gap:4px; flex-wrap:wrap; min-height:25px; }
        #ehqs-title { font-weight:bold; margin-right:2px; }
        #ehqs-tags { margin-top:4px; padding:3px 0 0; }
        #ehqs-root.ehqs-collapsed #ehqs-tags { display:none; }
        .ehqs-group { margin:0 0 4px; }
        .ehqs-group-head { display:block; width:100%; padding:2px 4px; border:0; border-bottom:1px solid #b5a69a;
            color:inherit; background:none; text-align:left; cursor:pointer; font:700 12px/18px arial,helvetica,sans-serif; }
        .ehqs-group-head:hover { background:rgba(128,103,105,.10); }
        .ehqs-group-items { display:flex; flex-wrap:wrap; padding-top:4px; }
        .ehqs-group.ehqs-group-closed .ehqs-group-items,
        .ehqs-group.ehqs-group-closed .ehqs-manager-items { display:none; }
        .ehqs-manager-group { margin:8px 0; }
        .ehqs-manager-heading { display:flex; align-items:center; gap:4px; border-bottom:1px solid #b5a69a; }
        .ehqs-manager-heading .ehqs-group-head { flex:1; width:auto; min-width:0; border-bottom:0; }
        .ehqs-manager-items { padding:0 4px; }
        .ehqs-btn { border:1px solid #806769; border-radius:5px; padding:1px 6px; cursor:pointer;
            color:#5c0d11; background:#f2efdf; font:700 12px/16px arial,helvetica,sans-serif;
            box-shadow:none; text-shadow:none; appearance:none; }
        .ehqs-btn:hover { background:#e8e3ce; }
        .ehqs-btn:disabled { opacity:.45; cursor:default; }
        .ehqs-toggle { width:22px; padding:1px 3px; font-weight:bold; }
        .ehqs-tag { display:block; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer;
            margin:0 2px 5px; padding:1px 4px; border:1px solid #806769; border-radius:5px;
            color:#5c0d11; background:#f2efdf; font:700 12px/16px arial,helvetica,sans-serif;
            text-decoration:none; box-shadow:none; text-shadow:none; }
        .ehqs-tag:hover { background:#e8e3ce; text-decoration:none; }
        .ehqs-switch { display:inline-flex; align-items:center; gap:4px; padding:1px 6px 1px 4px; border:1px solid #806769;
            border-radius:5px; color:#5c0d11; background:#f2efdf; cursor:pointer; user-select:none; white-space:nowrap;
            font:700 12px/16px arial,helvetica,sans-serif; box-shadow:none; text-shadow:none; }
        .ehqs-switch input { width:12px; height:12px; margin:0; accent-color:#508c52; cursor:pointer; }
        .ehqs-switch.ehqs-on { border-color:#5f985f; background:#e4efdc; }
        #ehqs-empty { opacity:.72; padding:2px 1px; }
        .ehqs-count { opacity:.62; margin-left:auto; white-space:nowrap; }
        dialog.ehqs-dialog { width:min(720px,calc(100vw - 24px)); max-height:82vh; padding:0; border:1px solid #806f63;
            border-radius:7px; color:#2e2722; background:#eee9df; box-shadow:0 12px 40px #0008; }
        dialog.ehqs-dialog::backdrop { background:#0008; }
        .ehqs-dhead { display:flex; align-items:center; padding:10px 12px; border-bottom:1px solid #b9aa9c; font-weight:bold; }
        .ehqs-close { margin-left:auto; border:0; background:none; font-size:20px; cursor:pointer; color:inherit; }
        .ehqs-body { padding:12px; overflow:auto; max-height:64vh; }
        .ehqs-field { display:grid; grid-template-columns:90px 1fr; gap:7px; align-items:center; margin:8px 0; }
        .ehqs-field input,.ehqs-field select { width:100%; padding:6px; border:1px solid #a69689; border-radius:3px;
            color:#222; background:#fff; }
        .ehqs-actions { display:flex; justify-content:flex-end; gap:7px; padding:10px 12px; border-top:1px solid #b9aa9c; }
        .ehqs-row { display:grid; grid-template-columns:minmax(100px,.8fr) minmax(150px,1.7fr) auto; gap:7px;
            align-items:center; padding:6px 0; border-bottom:1px solid #cfc4b9; }
        .ehqs-row-controls { display:flex; white-space:nowrap; }
        .ehqs-row-name,.ehqs-row-key { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ehqs-row-key { opacity:.72; }
        .ehqs-small { padding:2px 6px; min-width:28px; }
        .ehqs-help { opacity:.72; margin:4px 0 10px; }
        #ehqs-root.ehqs-dark { border-color:#5c5c5c; background:rgba(0,0,0,.22); }
        #ehqs-root.ehqs-dark .ehqs-group-head { border-color:#5c5c5c; }
        dialog.ehqs-dialog.ehqs-dark .ehqs-manager-heading { border-color:#5c5c5c; }
        #ehqs-root.ehqs-dark .ehqs-group-head:hover { background:rgba(255,255,255,.07); }
        #ehqs-root.ehqs-dark .ehqs-btn {
            color:#ddd; border-color:#989898; background:#4f535b; }
        #ehqs-root.ehqs-dark .ehqs-btn:hover { background:#5a5e66; }
        #ehqs-root.ehqs-dark .ehqs-tag { color:#ddd; border-color:#989898; background:#4f535b; }
        #ehqs-root.ehqs-dark .ehqs-tag:hover { background:#5a5e66; }
        #ehqs-root.ehqs-dark .ehqs-switch { color:#ddd; border-color:#989898; background:#4f535b; }
        #ehqs-root.ehqs-dark .ehqs-switch.ehqs-on { border-color:#8eae88; background:#4f6151; }
        dialog.ehqs-dialog.ehqs-dark { color:#ddd; background:#34302c; }
        dialog.ehqs-dialog.ehqs-dark .ehqs-field input,dialog.ehqs-dialog.ehqs-dark .ehqs-field select {
            color:#eee; background:#25211e; border-color:#766a61; }
        @media (prefers-color-scheme:dark) {
            dialog.ehqs-dialog { color:#ddd; background:#34302c; }
            .ehqs-field input,.ehqs-field select { color:#eee; background:#25211e; border-color:#766a61; }
        }
        @media (max-width:600px) {
            #ehqs-root { width:calc(100% - 6px); }
            .ehqs-count { width:100%; margin-left:0; }
            .ehqs-field { grid-template-columns:1fr; }
            .ehqs-row { grid-template-columns:1fr auto; }
            .ehqs-row-key { grid-column:1 / -1; grid-row:2; }
        }
    `);

    const root = el('div', { id: 'ehqs-root' });
    if (location.hostname === 'exhentai.org') root.classList.add('ehqs-dark');
    root.classList.toggle('ehqs-collapsed', Boolean(GM_getValue(COLLAPSED_KEY, true)));
    const head = el('div', { id: 'ehqs-head' });
    const toggle = button('', toggleCollapsed, 'ehqs-btn ehqs-toggle');
    const wnacgSwitch = el('label', { className: `ehqs-switch${wnacgMode ? ' ehqs-on' : ''}`, title: '开启后，点击快速搜索标签会转到 WNACG 搜索' });
    const wnacgCheckbox = el('input', { type: 'checkbox' });
    wnacgCheckbox.checked = wnacgMode;
    wnacgCheckbox.addEventListener('change', () => {
        wnacgMode = wnacgCheckbox.checked;
        GM_setValue(WNACG_KEY, wnacgMode);
        wnacgSwitch.classList.toggle('ehqs-on', wnacgMode);
        wnacgSwitch.title = wnacgMode ? 'WNACG 搜索已开启' : '开启后，点击快速搜索标签会转到 WNACG 搜索';
        render();
    });
    wnacgSwitch.append(wnacgCheckbox, el('span', { text: 'WNACG' }));
    head.append(
        toggle,
        el('span', { id: 'ehqs-title', text: '快速搜索' }),
        button('汉语', searchChinese),
        wnacgSwitch,
        button('跳转WNACG', searchCurrentOnWnacg),
        button('＋ 当前搜索', addCurrent),
        button('＋ 手动新增', () => openEditor()),
        button('导入 .db', () => fileInput.click()),
        button('导出 .db', exportDatabase),
        button('管理', openManager),
        el('span', { className: 'ehqs-count' })
    );
    const tagBox = el('div', { id: 'ehqs-tags' });
    const fileInput = el('input', { type: 'file', accept: '.db,.sqlite,.sqlite3,application/x-sqlite3' });
    fileInput.hidden = true;
    fileInput.addEventListener('change', importDatabase);
    root.append(head, tagBox, fileInput);
    form.append(root);

    const editor = makeDialog('新增快速搜索');
    editor.body.append(
        field('显示名称', el('input', { id: 'ehqs-name', maxlength: '200', placeholder: '例如：中文漫画' })),
        field('搜索关键词', el('input', { id: 'ehqs-keyword', maxlength: '1000', placeholder: '例如：language:chinese$' })),
        field('搜索类型', select('ehqs-mode', [['0','普通搜索'],['1','上传者'],['2','标签'],['5','订阅'],['3','热门'],['6','排行']]))
    );
    editor.actions.append(button('取消', () => editor.dialog.close()), button('保存', saveEditor));
    document.body.append(editor.dialog);

    const manager = makeDialog('管理快速搜索');
    document.body.append(manager.dialog);
    render();
    updateToggle();
    void updateTranslations(false);

    function normalizeList(value) {
        if (!Array.isArray(value)) return [];
        return value.map((item, index) => ({
            id: finite(item.id, index + 1), name: String(item.name || item.keyword || `标签 ${index + 1}`),
            mode: finite(item.mode, 0), category: finite(item.category, -1), keyword: item.keyword == null ? '' : String(item.keyword),
            advanceSearch: finite(item.advanceSearch, -1), minRating: finite(item.minRating, -1),
            pageFrom: finite(item.pageFrom, -1), pageTo: finite(item.pageTo, -1), position: index
        }));
    }

    function normalizeTranslation(value) {
        if (!value || typeof value !== 'object' || !value.map || typeof value.map !== 'object') {
            return { sha: '', checkedAt: 0, map: {}, bare: {}, size: 0 };
        }
        return { sha: String(value.sha || ''), checkedAt: finite(value.checkedAt, 0), map: value.map,
            bare: buildBareMap(value.map), size: Object.keys(value.map).length };
    }

    function normalizeGroupSettings(value) {
        const known = new Set(DEFAULT_GROUP_ORDER);
        const order = Array.isArray(value?.order) ? value.order.filter((name, index, list) => known.has(name) && list.indexOf(name) === index) : [];
        for (const name of DEFAULT_GROUP_ORDER) if (!order.includes(name)) order.push(name);
        const closed = Array.isArray(value?.closed)
            ? value.closed.filter(name => known.has(name))
            : [...DEFAULT_CLOSED_GROUPS];
        return { order, closed: [...new Set(closed)] };
    }

    function saveGroupSettings() {
        GM_setValue(GROUP_SETTINGS_KEY, groupSettings);
        render();
        if (manager.dialog.open) renderManager();
    }

    function finite(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.trunc(number) : fallback;
    }

    function save() {
        tags.forEach((tag, index) => { tag.position = index; tag.id = index + 1; });
        GM_setValue(STORAGE_KEY, tags);
        render();
    }

    function toggleCollapsed() {
        const collapsed = root.classList.toggle('ehqs-collapsed');
        GM_setValue(COLLAPSED_KEY, collapsed);
        updateToggle();
    }

    function updateToggle() {
        const collapsed = root.classList.contains('ehqs-collapsed');
        toggle.textContent = collapsed ? '▸' : '▾';
        toggle.title = collapsed ? '展开快速搜索标签' : '折叠快速搜索标签';
        toggle.setAttribute('aria-expanded', String(!collapsed));
    }

    function render() {
        tagBox.replaceChildren();
        root.querySelector('.ehqs-count').textContent = `${tags.length} 个标签`;
        if (!tags.length) {
            tagBox.append(el('span', { id: 'ehqs-empty', text: '尚无标签，可导入 EhViewer 导出的数据库。' }));
            return;
        }
        const groups = groupTags();
        for (const name of groupSettings.order) {
            const members = groups.get(name);
            if (!members?.length) continue;
            const section = el('section', { className: 'ehqs-group' });
            const heading = makeGroupHeading(section, name, members.length, groupOpen);
            const items = el('div', { className: 'ehqs-group-items' });
            for (const { tag } of members) {
                const translated = translateLabel(tag.name);
                const item = el('a', {
                    className: `ehqs-tag${translated ? ' ehqs-translated' : ''}`,
                    href: buildSearchUrl(tag),
                    text: translated || tag.name
                });
                item.title = `${translated ? `原文：${tag.name}\n` : ''}${describe(tag)}`;
                items.append(item);
            }
            section.append(heading, items);
            tagBox.append(section);
        }
    }

    function groupTags() {
        const groups = new Map();
        tags.forEach((tag, index) => {
            const name = classifyTag(tag);
            if (!groups.has(name)) groups.set(name, []);
            groups.get(name).push({ tag, index });
        });
        return groups;
    }

    function makeGroupHeading(section, name, count, state) {
        const opened = state.has(name) ? state.get(name) : !groupSettings.closed.includes(name);
        section.classList.toggle('ehqs-group-closed', !opened);
        const heading = button(`${opened ? '▾' : '▸'} ${name} (${count})`, () => {
            const open = !section.classList.toggle('ehqs-group-closed');
            state.set(name, open);
            heading.textContent = `${open ? '▾' : '▸'} ${name} (${count})`;
            heading.setAttribute('aria-expanded', String(open));
        }, 'ehqs-group-head');
        heading.setAttribute('aria-expanded', String(opened));
        return heading;
    }

    function classifyTag(tag) {
        if (tag.mode === 1) return '上传者';
        if (tag.mode === 3) return '热门';
        if (tag.mode === 5) return '订阅';
        if (tag.mode === 6) return '排行';
        const keyword = String(tag.keyword || '');
        // Consume quoted values as one token so a word inside a quoted value is not treated as another namespace.
        const namespaces = [...keyword.matchAll(/(?:^|\s)-?([a-z]+):(?:"[^"]*"|[^\s"]+)/gi)]
            .map(match => NAMESPACE_GROUPS[match[1].toLowerCase()])
            .filter(Boolean);
        // A language filter is secondary to the searched subject, such as artist:... language:chinese$.
        if (namespaces.length) return namespaces.find(name => name !== '语言') || '语言';
        const displayNamespace = /^(?:\s*)-?([a-z]+):/i.exec(String(tag.name || ''));
        return NAMESPACE_GROUPS[displayNamespace?.[1]?.toLowerCase()] || '普通搜索';
    }

    function buildSearchUrl(tag) {
        if (wnacgMode) {
            const query = buildWnacgQuery(tag);
            if (!query) return '#';
            return wnacgSearchUrl(query);
        }
        const base = `${location.protocol}//${location.host}`;
        const keyword = tag.keyword || '';
        if (tag.mode === 1) return `${base}/uploader/${encodeURIComponent(keyword)}`;
        if (tag.mode === 2) return `${base}/tag/${encodeURIComponent(keyword)}`;
        if (tag.mode === 3) return `${base}/popular`;
        if (tag.mode === 5) return `${base}/watched` + buildQuery(tag);
        if (tag.mode === 6) return `https://e-hentai.org/toplist.php?tl=${encodeURIComponent(keyword)}`;
        return `${base}/` + buildQuery(tag);
    }

    function buildWnacgQuery(tag) {
        const translated = translateLabel(tag.name) || translateLabel(tag.keyword);
        let query = translated || tag.keyword || tag.name || '';
        query = query
            .replace(/(?:艺术家|团队|原作|角色|Coser|语言|女性|男性|混合|其他|地点|重新分类)：/g, '')
            .replace(/\b(?:artist|group|parody|character|cosplayer|language|female|male|mixed|other|location|reclass|a|g|p|c|cos|l|f|m|x|o|loc|r):/gi, '')
            .replace(/@[a-z0-9_-]+/gi, ' ')
            .replace(/["$]/g, '')
            .replace(/_/g, ' ')
            .replace(/\bchinese\b/gi, ' ')
            .replace(/(^|\s)汉语(?=\s|$)/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!query) query = String(tag.keyword || tag.name || '').replace(/["$]/g, '').trim();
        return query;
    }

    function wnacgSearchUrl(query) {
        const params = new URLSearchParams({ q: query, m: '', syn: 'yes', f: '_all', s: 'create_time_DESC' });
        return `https://www.wnacg.com/search/index.php?${params}`;
    }

    function searchCurrentOnWnacg() {
        if (!input.value.trim()) return void alert('搜索框为空，请先输入搜索词。');
        const query = buildWnacgQuery({ name: input.value, keyword: input.value });
        if (query) location.assign(wnacgSearchUrl(query));
    }

    function addGalleryWnacgLink() {
        const subtitle = document.querySelector('#gj')?.textContent;
        const mainTitle = document.querySelector('#gn')?.textContent;
        const renameRow = document.querySelector('#gd5 #renamelink')?.closest('p');
        if (!renameRow || document.querySelector('#ehqs-gallery-wnacg')) return;
        const query = cleanGalleryTitle(subtitle) || cleanGalleryTitle(mainTitle);
        if (!query) return;
        GM_addStyle(`
            #ehqs-gallery-wnacg-row { padding-left:18px; }
            #ehqs-gallery-wnacg { color:#1769be !important; font:700 12px arial,helvetica,sans-serif; text-decoration:none; }
            #ehqs-gallery-wnacg:hover { text-decoration:underline; }
            .ehqs-gallery-dark #ehqs-gallery-wnacg { color:#75b3ff !important; }
        `);
        const row = el('p', { id: 'ehqs-gallery-wnacg-row', className: `g2${location.hostname === 'exhentai.org' ? ' ehqs-gallery-dark' : ''}` });
        const link = el('a', { id: 'ehqs-gallery-wnacg', href: wnacgSearchUrl(query), text: 'WNACG搜同名' });
        link.title = `在 WNACG 搜索：${query}`;
        row.append(link);
        renameRow.insertAdjacentElement('afterend', row);
    }

    function cleanGalleryTitle(title) {
        return String(title || '').replace(/\[[^\]]*\]|［[^］]*］|【[^】]*】/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function buildQuery(tag) {
        const p = new URLSearchParams();
        if (tag.keyword) p.set('f_search', tag.keyword);
        if (tag.category > 0 && tag.category < ALL_CATEGORIES) p.set('f_cats', String(ALL_CATEGORIES ^ tag.category));
        const adv = tag.advanceSearch;
        if (adv > 0 || tag.minRating > 0 || tag.pageFrom > 0 || tag.pageTo > 0) {
            p.set('advsearch', '1');
            [['f_sh',1],['f_sto',2],['f_sfl',4],['f_sfu',8],['f_sft',16]].forEach(([key, bit]) => {
                if ((adv & bit) !== 0) p.set(key, 'on');
            });
            if (tag.minRating > 0) p.set('f_srdd', String(tag.minRating));
            if (tag.pageFrom > 0) p.set('f_spf', String(tag.pageFrom));
            if (tag.pageTo > 0) p.set('f_spt', String(tag.pageTo));
        }
        const query = p.toString();
        return query ? `?${query}` : '';
    }

    function addCurrent() {
        const keyword = input.value.trim();
        if (!keyword) return void alert('搜索框为空，请先输入搜索关键词。');
        const params = new URLSearchParams(location.search);
        const candidate = {
            name: keyword, keyword, mode: 0,
            category: params.has('f_cats') ? (ALL_CATEGORIES ^ finite(params.get('f_cats'), 0)) : -1,
            advanceSearch: readAdvanced(params), minRating: finite(params.get('f_srdd'), -1),
            pageFrom: finite(params.get('f_spf'), -1), pageTo: finite(params.get('f_spt'), -1)
        };
        openEditor(candidate);
    }

    function searchChinese() {
        const keyword = input.value.trim();
        if (!/(?:^|\s)language:(?:"?chinese\$?"?)(?=\s|$)/i.test(keyword)) {
            input.value = `${keyword}${keyword ? ' ' : ''}language:chinese$`;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (form instanceof HTMLFormElement) form.requestSubmit();
        else {
            const params = new URLSearchParams(location.search);
            params.set('f_search', input.value);
            location.assign(`${location.pathname}?${params}`);
        }
    }

    function readAdvanced(params) {
        if (params.get('advsearch') !== '1') return -1;
        return [['f_sh',1],['f_sto',2],['f_sfl',4],['f_sfu',8],['f_sft',16]]
            .reduce((sum, [key, bit]) => sum | (params.get(key) === 'on' ? bit : 0), 0);
    }

    function openEditor(tag = null, index = -1) {
        editingIndex = index;
        editor.dialog.querySelector('.ehqs-dhead span').textContent = index >= 0 ? '编辑快速搜索' : '新增快速搜索';
        editor.dialog.querySelector('#ehqs-name').value = tag?.name || '';
        editor.dialog.querySelector('#ehqs-keyword').value = tag?.keyword || '';
        editor.dialog.querySelector('#ehqs-mode').value = String(tag?.mode ?? 0);
        editor.dialog.dataset.extra = JSON.stringify(tag || {});
        editor.dialog.showModal();
        editor.dialog.querySelector('#ehqs-name').focus();
    }

    function saveEditor() {
        const name = editor.dialog.querySelector('#ehqs-name').value.trim();
        const keyword = editor.dialog.querySelector('#ehqs-keyword').value.trim();
        const mode = finite(editor.dialog.querySelector('#ehqs-mode').value, 0);
        if (!name) return void alert('请输入显示名称。');
        if (![3].includes(mode) && !keyword) return void alert('请输入搜索关键词。');
        const extra = JSON.parse(editor.dialog.dataset.extra || '{}');
        const value = normalizeList([{ ...extra, name, keyword, mode }])[0];
        if (editingIndex >= 0) tags[editingIndex] = value; else tags.push(value);
        save();
        editor.dialog.close();
        if (manager.dialog.open) renderManager();
    }

    function openManager() {
        renderManager();
        manager.dialog.showModal();
    }

    function renderManager() {
        const scrollTop = manager.body.scrollTop;
        manager.body.replaceChildren();
        const translationInfo = translation.sha
            ? `标签翻译：${translation.sha.slice(0, 7)}，检查于 ${new Date(translation.checkedAt).toLocaleString()}`
            : '标签翻译：尚未下载';
        manager.body.append(el('p', { className: 'ehqs-help', text: translationInfo }));
        if (!tags.length) manager.body.append(el('p', { className: 'ehqs-help', text: '当前没有快速搜索标签。' }));
        const groups = groupTags();
        const visibleOrder = groupSettings.order.filter(name => groups.has(name));
        for (const name of visibleOrder) {
            const members = groups.get(name);
            if (!members?.length) continue;
            const section = el('section', { className: 'ehqs-group ehqs-manager-group' });
            const heading = makeGroupHeading(section, name, members.length, managerGroupOpen);
            const headingRow = el('div', { className: 'ehqs-manager-heading' });
            const up = button('↑', () => moveGroup(name, -1), 'ehqs-btn ehqs-small');
            const down = button('↓', () => moveGroup(name, 1), 'ehqs-btn ehqs-small');
            up.title = `上移${name}分类`;
            down.title = `下移${name}分类`;
            up.disabled = visibleOrder.indexOf(name) === 0;
            down.disabled = visibleOrder.indexOf(name) === visibleOrder.length - 1;
            const closed = groupSettings.closed.includes(name);
            const defaultToggle = button(`默认折叠：${closed ? '是' : '否'}`, () => toggleDefaultClosed(name), 'ehqs-btn ehqs-small');
            defaultToggle.title = `设置${name}分类打开网页时是否默认折叠`;
            headingRow.append(heading, up, down, defaultToggle);
            const items = el('div', { className: 'ehqs-manager-items' });
            members.forEach(({ tag, index }) => {
                const controls = el('div', { className: 'ehqs-row-controls' });
                controls.append(
                    button('↑', () => move(index, -1), 'ehqs-btn ehqs-small'),
                    button('↓', () => move(index, 1), 'ehqs-btn ehqs-small'),
                    button('编辑', () => openEditor(tag, index), 'ehqs-btn ehqs-small'),
                    button('删除', () => { tags.splice(index, 1); save(); renderManager(); }, 'ehqs-btn ehqs-small')
                );
                const displayName = translateLabel(tag.name) || translateLabel(tag.keyword) || tag.name;
                const originalKeyword = tag.keyword || tag.name || typeName(tag.mode);
                items.append(el('div', { className: 'ehqs-row' }, [
                    el('span', { className: 'ehqs-row-name', text: displayName, title: tag.name }),
                    el('span', { className: 'ehqs-row-key', text: originalKeyword, title: originalKeyword }), controls
                ]));
            });
            section.append(headingRow, items);
            manager.body.append(section);
        }
        const updateButton = button(translationUpdating ? '正在更新翻译…' : '立即更新翻译', async () => {
            updateButton.disabled = true;
            await updateTranslations(true);
            renderManager();
        });
        updateButton.disabled = translationUpdating;
        manager.actions.replaceChildren(updateButton, button('关闭', () => manager.dialog.close()));
        manager.body.scrollTop = scrollTop;
    }

    function moveGroup(name, delta) {
        const groups = groupTags();
        const visible = groupSettings.order.filter(group => groups.has(group));
        const position = visible.indexOf(name);
        const target = visible[position + delta];
        if (!target) return;
        const from = groupSettings.order.indexOf(name);
        const to = groupSettings.order.indexOf(target);
        [groupSettings.order[from], groupSettings.order[to]] = [groupSettings.order[to], groupSettings.order[from]];
        saveGroupSettings();
    }

    function toggleDefaultClosed(name) {
        if (groupSettings.closed.includes(name)) groupSettings.closed = groupSettings.closed.filter(group => group !== name);
        else groupSettings.closed.push(name);
        groupOpen.delete(name);
        managerGroupOpen.delete(name);
        saveGroupSettings();
    }

    function move(index, delta) {
        const members = groupTags().get(classifyTag(tags[index]));
        const position = members.findIndex(member => member.index === index);
        const target = members[position + delta]?.index;
        if (target === undefined) return;
        [tags[index], tags[target]] = [tags[target], tags[index]];
        save(); renderManager();
    }

    async function importDatabase(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try {
            const SQL = await initSqlJs();
            const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
            const result = db.exec('SELECT _id, NAME, MODE, CATEGORY, KEYWORD, ADVANCE_SEARCH, MIN_RATING, PAGE_FROM, PAGE_TO, POSITION FROM QUICK_SEARCH ORDER BY POSITION, _id');
            db.close();
            if (!result.length) throw new Error('QUICK_SEARCH 表为空');
            const incoming = result[0].values.map(row => ({
                id: row[0], name: row[1], mode: row[2], category: row[3], keyword: row[4], advanceSearch: row[5],
                minRating: row[6], pageFrom: row[7], pageTo: row[8], position: row[9]
            }));
            const known = new Set(tags.map(identity));
            let added = 0;
            for (const tag of normalizeList(incoming)) if (!known.has(identity(tag))) {
                known.add(identity(tag)); tags.push(tag); added++;
            }
            save();
            alert(`读取 ${incoming.length} 条，新增 ${added} 条，跳过 ${incoming.length - added} 条重复标签。`);
        } catch (error) {
            console.error('[EH Quick Search] import failed', error);
            alert(`导入失败：${error?.message || error}\n请选择包含 QUICK_SEARCH 表的 EhViewer SQLite 数据库。`);
        }
    }

    async function exportDatabase() {
        try {
            const SQL = await initSqlJs();
            const db = new SQL.Database();
            db.run('CREATE TABLE QUICK_SEARCH (`_id` INTEGER, `NAME` TEXT NOT NULL, `MODE` INTEGER NOT NULL, `CATEGORY` INTEGER NOT NULL, `KEYWORD` TEXT, `ADVANCE_SEARCH` INTEGER NOT NULL, `MIN_RATING` INTEGER NOT NULL, `PAGE_FROM` INTEGER NOT NULL, `PAGE_TO` INTEGER NOT NULL, `POSITION` INTEGER NOT NULL, PRIMARY KEY(`_id`))');
            const stmt = db.prepare('INSERT INTO QUICK_SEARCH VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            tags.forEach((t, i) => stmt.run([i + 1, t.name, t.mode, t.category, t.keyword || null, t.advanceSearch, t.minRating, t.pageFrom, t.pageTo, i]));
            stmt.free();
            db.run('CREATE TABLE android_metadata (locale TEXT)');
            db.run("INSERT INTO android_metadata VALUES ('zh_CN')");
            const bytes = db.export(); db.close();
            download(new Blob([bytes], { type: 'application/x-sqlite3' }), `eh-quick-search-${dateStamp()}.db`);
        } catch (error) {
            console.error('[EH Quick Search] export failed', error);
            alert(`导出失败：${error?.message || error}`);
        }
    }

    async function updateTranslations(force) {
        if (translationUpdating) return;
        if (!force && Date.now() - translation.checkedAt < UPDATE_INTERVAL) return;
        translationUpdating = true;
        try {
            const release = await firstJson([
                'https://ehtt.fly.dev/octokit/release',
                'https://api.github.com/repos/EhTagTranslation/Database/releases/latest'
            ]);
            if (!release || typeof release.target_commitish !== 'string') throw new Error('无法读取最新翻译版本');
            const metadataMatch = /<!--([^]+?)-->/i.exec(String(release.body || ''));
            if (!metadataMatch) throw new Error('翻译版本信息格式不受支持');
            const metadata = JSON.parse(metadataMatch[1]);
            const mirrorSha = String(metadata.mirror || '');
            if (!/^[a-f0-9]{7,40}$/i.test(mirrorSha)) throw new Error('翻译镜像版本无效');
            if (translation.sha === release.target_commitish && Object.keys(translation.map).length) {
                translation.checkedAt = Date.now();
                persistTranslation();
                return;
            }
            const suffix = `/gh/EhTagTranslation/Database@${mirrorSha}/db.html.json`;
            const database = await firstJson([
                `https://fastly.jsdelivr.net${suffix}`,
                `https://gcore.jsdelivr.net${suffix}`,
                `https://cdn.jsdelivr.net${suffix}`,
                `https://testingcf.jsdelivr.net${suffix}`,
                `https://test1.jsdelivr.net${suffix}`,
                `https://originfastly.jsdelivr.net${suffix}`,
                `https://cdn.statically.io/gh/EhTagTranslation/Database/${mirrorSha}/db.html.json`,
                `https://rawcdn.githack.com/EhTagTranslation/Database/${mirrorSha}/db.html.json`
            ]);
            if (!database || !Array.isArray(database.data)) throw new Error('翻译数据库格式不正确');
            if (database.head?.sha && database.head.sha !== release.target_commitish) throw new Error('翻译数据库版本不匹配');
            const map = flattenTranslationDatabase(database);
            if (Object.keys(map).length < 1000) throw new Error('翻译数据库内容不完整');
            translation = { sha: release.target_commitish, checkedAt: Date.now(), map, bare: buildBareMap(map), size: Object.keys(map).length };
            persistTranslation();
            render();
            if (manager.dialog.open) renderManager();
        } catch (error) {
            console.warn('[EH Quick Search] translation update failed', error);
            translation.checkedAt = Date.now() - UPDATE_INTERVAL + 6 * 60 * 60 * 1000;
            persistTranslation();
            if (force) alert(`翻译更新失败：${error?.message || error}`);
        } finally {
            translationUpdating = false;
        }
    }

    function persistTranslation() {
        GM_setValue(TRANSLATION_KEY, { sha: translation.sha, checkedAt: translation.checkedAt, map: translation.map });
    }

    function flattenTranslationDatabase(database) {
        const shortNamespace = {
            reclass:'r', language:'l', parody:'p', character:'c', group:'g', artist:'a', cosplayer:'cos',
            male:'m', female:'f', mixed:'x', other:'o', location:'loc', temp:''
        };
        const map = {};
        for (const group of database.data) {
            const namespace = String(group?.namespace || '').toLowerCase();
            if (!group?.data || typeof group.data !== 'object' || namespace === 'rows') continue;
            const prefix = shortNamespace[namespace] ?? namespace;
            for (let [key, entry] of Object.entries(group.data)) {
                key = key.replace(/_/g, ' ').trim().toLowerCase();
                if (!key || !entry || typeof entry !== 'object') continue;
                const name = cleanTranslation(entry.name);
                if (name && name.toLowerCase() !== key) map[prefix ? `${prefix}:${key}` : key] = name;
            }
        }
        return map;
    }

    function cleanTranslation(value) {
        if (typeof value !== 'string') return '';
        const doc = new DOMParser().parseFromString(value, 'text/html');
        return (doc.body.textContent || '').replace(/[\u{1F000}-\u{1FAFF}]/gu, '').trim();
    }

    function buildBareMap(fullMap) {
        const bare = {};
        for (const [fullKey, value] of Object.entries(fullMap)) {
            const key = fullKey.includes(':') ? fullKey.slice(fullKey.indexOf(':') + 1) : fullKey;
            if (!(key in bare)) bare[key] = value;
            else if (bare[key] !== value) bare[key] = null;
        }
        return bare;
    }

    function translateLabel(label) {
        if (!translation.size) return '';
        const namespaceNames = { a:'艺术家', artist:'艺术家', g:'团队', group:'团队', p:'原作', parody:'原作',
            c:'角色', character:'角色', cos:'Coser', cosplayer:'Coser', l:'语言', language:'语言',
            f:'女性', female:'女性', m:'男性', male:'男性', x:'混合', mixed:'混合', o:'其他', other:'其他',
            loc:'地点', location:'地点', r:'重新分类', reclass:'重新分类' };
        let changed = false;
        let text = String(label).replace(/\b([a-z]+):(?:"([^"@]+?)\$?"|([^\s@]+?)(?:\$)?)(?=\s|@|$)/gi, (whole, ns, quoted, plain) => {
            const raw = (quoted || plain || '').replace(/\$$/, '').replace(/_/g, ' ').toLowerCase();
            const short = ({artist:'a',group:'g',parody:'p',character:'c',cosplayer:'cos',language:'l',female:'f',male:'m',mixed:'x',other:'o',location:'loc',reclass:'r'})[ns.toLowerCase()] || ns.toLowerCase();
            const cn = translation.map[`${short}:${raw}`];
            if (!cn) return whole;
            changed = true;
            return `${namespaceNames[ns.toLowerCase()] || namespaceNames[short] || ns}：${cn}`;
        });
        text = text.replace(/(?:"([^"@]+?)\$?"|\b([a-z][a-z0-9._ -]*?)\$?)(?=\s+|@|$)/gi, (whole, quoted, plain) => {
            if (whole.includes('：') || /^[a-z]+:/i.test(whole)) return whole;
            const raw = (quoted || plain || '').trim().replace(/\$$/, '').replace(/_/g, ' ').toLowerCase();
            const cn = translation.bare[raw] || translation.map[`l:${raw}`];
            if (!cn) return whole;
            changed = true;
            return cn;
        });
        return changed ? text.replace(/\s+/g, ' ').trim() : '';
    }

    async function firstJson(urls) {
        let lastError;
        for (const url of urls) {
            try { return await requestJson(url); }
            catch (error) { lastError = error; }
        }
        throw lastError || new Error('所有下载地址均不可用');
    }

    function requestJson(url) {
        return new Promise((resolve, reject) => GM_xmlhttpRequest({
            method: 'GET', url, timeout: 30000,
            headers: { Accept: 'application/json' },
            onload: response => {
                if (response.status < 200 || response.status >= 300) return reject(new Error(`${response.status} ${response.statusText || url}`));
                try { resolve(JSON.parse(response.responseText)); }
                catch (error) { reject(new Error(`JSON 解析失败：${error.message}`)); }
            },
            ontimeout: () => reject(new Error(`请求超时：${url}`)),
            onerror: () => reject(new Error(`请求失败：${url}`))
        }));
    }

    function identity(tag) {
        return JSON.stringify([tag.name, tag.mode, tag.category, tag.keyword, tag.advanceSearch, tag.minRating, tag.pageFrom, tag.pageTo]);
    }

    function describe(tag) {
        const parts = [tag.keyword || typeName(tag.mode)];
        if (tag.minRating > 0) parts.push(`最低 ${tag.minRating} 星`);
        if (tag.pageFrom > 0 || tag.pageTo > 0) parts.push(`页数 ${tag.pageFrom > 0 ? tag.pageFrom : '不限'}–${tag.pageTo > 0 ? tag.pageTo : '不限'}`);
        return parts.join('\n');
    }

    function typeName(mode) {
        return ({ 0:'普通搜索', 1:'上传者', 2:'标签', 3:'热门', 5:'订阅', 6:'排行' })[mode] || `模式 ${mode}`;
    }

    function dateStamp() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    }

    function download(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: name });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function makeDialog(title) {
        const dialog = el('dialog', { className: `ehqs-dialog${location.hostname === 'exhentai.org' ? ' ehqs-dark' : ''}` });
        const header = el('div', { className: 'ehqs-dhead' }, [el('span', { text: title }), button('×', () => dialog.close(), 'ehqs-close')]);
        const body = el('div', { className: 'ehqs-body' });
        const actions = el('div', { className: 'ehqs-actions' });
        dialog.append(header, body, actions);
        dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
        return { dialog, body, actions };
    }

    function field(label, control) {
        return el('label', { className: 'ehqs-field' }, [el('span', { text: label }), control]);
    }

    function select(id, options) {
        const node = el('select', { id });
        options.forEach(([value, text]) => node.append(el('option', { value, text })));
        return node;
    }

    function button(text, handler, className = 'ehqs-btn') {
        const node = el('button', { type: 'button', className, text });
        node.addEventListener('click', handler);
        return node;
    }

    function el(tag, props = {}, children = []) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(props)) {
            if (key === 'text') node.textContent = value;
            else if (key === 'className') node.className = value;
            else node.setAttribute(key, value);
        }
        node.append(...children);
        return node;
    }
})();
