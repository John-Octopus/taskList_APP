/**
 * Browser half of dsh-conversation-save.
 *
 * Adds one entry to the sidebar panel list: **Export conversations**. Its main
 * panel lists every Session of this workspace with a checkbox, so one click
 * downloads the selected conversations as a single `conversations.json` array.
 * The same controller backs the composer button and the `/save` command, which
 * still export only the current Session.
 *
 * @module dsh-conversation-save/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-conversation-save',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Browser-relative download route; mirrors the Host `routePath`. */
    const ROUTE = 'api/conversation-save';

    /** Browser-relative listing route; mirrors the Host `listingPath`. */
    const LISTING = 'api/conversation-save/sessions';

    /** Panel id shared by the sidebar entry and the main panel cell. */
    const PANEL_ID = 'conversation-save';

    /**
     * Collapse untrusted text into the filename the Host route sends.
     * @param sessionId - the exported Session id.
     * @returns one browser download filename.
     */
    function filenameOf(sessionId) {
      return `conversations-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
    }

    /**
     * Hand a Host download route to the browser download manager.
     * @param url - document-relative download route.
     * @param filename - browser download filename.
     * @returns nothing.
     */
    function downloadUrl(url, filename) {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }

    /**
     * Name the selection's download.
     * @param sessions - the selected Session rows.
     * @returns the browser download filename.
     */
    function selectionName(sessions) {
      return sessions.length === 1 ? `${String(sessions[0].title).replace(/[\\/:*?"<>|]/g, '').trim() || 'session'}.json` : `conversations-${sessions.length}.json`;
    }

    /** Owns every export request and the picker's shared state. */
    class ConversationSaveController {
      active = new Map();
      listeners = new Set();
      state = { status: 'idle', message: '', sessionId: '' };
      rows = [];
      listing = 'idle';
      listingError = '';
      disposed = false;

      /**
       * @param fetcher - HTTP carrier used for the routes.
       * @param save - browser save operation.
       */
      constructor(fetcher = (input, init) => fetch(input, init), save = downloadUrl) {
        this.fetcher = fetcher;
        this.save = save;
      }

      /** @returns the current published state. */
      getState() {
        return this.state;
      }

      /**
       * @param listener - called after every published state change.
       * @returns the unsubscribe function.
       */
      subscribe(listener) {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      }

      /**
       * Publish one state change to every listener.
       * @param next - the fields to merge into the published state.
       * @returns nothing.
       */
      publish(next) {
        this.state = { ...this.state, ...next };
        for (const listener of [...this.listeners]) listener(this.state);
      }

      /**
       * Read the workspace's Session rows once.
       * @param force - read again even when a listing is already cached.
       * @returns after the listing settles.
       */
      async load(force = false) {
        if (this.disposed) return;
        if (!force && this.listing === 'ready') return;
        if (this.listing === 'loading') return;
        this.listing = 'loading';
        this.listingError = '';
        this.publish({});
        try {
          const response = await this.fetcher(LISTING, { method: 'GET', headers: { accept: 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.json();
          this.rows = Array.isArray(body?.sessions) ? body.sessions : [];
          this.listing = 'ready';
        } catch (error) {
          this.rows = [];
          this.listing = 'error';
          this.listingError = String(error?.message ?? error);
        }
        if (!this.disposed) this.publish({});
      }

      /**
       * Export one Session, the shape the `/save` command and the dock use.
       * @param sessionId - the Session to export.
       * @returns after the browser save starts or a failure is published.
       */
      download(sessionId) {
        const id = String(sessionId ?? '');
        if (this.disposed || id === '') return Promise.resolve();
        const existing = this.active.get(id);
        if (existing !== undefined) return existing;
        const done = this.run([id], filenameOf(id), id).finally(() => {
          this.active.delete(id);
        });
        this.active.set(id, done);
        return done;
      }

      /**
       * Export the picker's selection as one array document.
       * @param sessions - the selected rows.
       * @returns after the browser save starts or a failure is published.
       */
      downloadSelection(sessions) {
        if (this.disposed || sessions.length === 0) return Promise.resolve();
        const ids = sessions.map((row) => row.id);
        const key = ids.join(',');
        const existing = this.active.get(key);
        if (existing !== undefined) return existing;
        const done = this.runMany(ids, selectionName(sessions)).finally(() => {
          this.active.delete(key);
        });
        this.active.set(key, done);
        return done;
      }

      /**
       * Preflight the route, then hand it to the browser download manager.
       * @param ids - the Sessions to export.
       * @param filename - the browser filename.
       * @param sessionId - the single Session id, for the dock's state line.
       * @returns after the save starts or the failure is published.
       */
      async run(ids, filename, sessionId = '') {
        return this.runMany(ids, filename, sessionId);
      }

      /**
       * Preflight the route, then hand it to the browser download manager.
       * @param ids - the Sessions to export.
       * @param filename - the browser filename.
       * @param sessionId - the single Session id, for the dock's state line.
       * @returns after the save starts or the failure is published.
       */
      async runMany(ids, filename, sessionId = '') {
        this.publish({ status: 'saving', message: '', sessionId });
        const query = new URLSearchParams();
        for (const id of ids) query.append('sessionId', id);
        const route = `${ROUTE}?${query.toString()}`;
        try {
          const response = await this.fetcher(route, { method: 'HEAD' });
          if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`HTTP ${response.status}${detail === '' ? '' : ` ${detail}`}`);
          }
          this.save(route, filename);
          this.publish({ status: 'saved', message: '', sessionId });
        } catch (error) {
          if (this.disposed) return;
          this.publish({ status: 'error', message: String(error?.message ?? error), sessionId });
        }
      }

      /** Whether an export is in flight. @returns the busy flag. */
      isBusy() {
        return this.state.status === 'saving';
      }
    }

    /** Shared inline styles, all expressed through the host theme tokens. */
    const S = {
      page: { padding: '16px 20px', fontSize: '13px', color: 'var(--dsw-alias-label-primary)', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'hidden' },
      head: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' },
      title: { fontSize: '15px', fontWeight: '600' },
      hint: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
      bar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      button: { height: '26px', padding: '0 10px', fontSize: '12px', fontFamily: 'inherit', color: 'var(--dsw-alias-label-primary)', background: 'transparent', border: '1px solid var(--dsw-alias-border-secondary, currentColor)', borderRadius: '6px', cursor: 'pointer' },
      primary: { height: '26px', padding: '0 12px', fontSize: '12px', fontFamily: 'inherit', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-fill-secondary, rgba(127,127,127,0.14))', border: '1px solid var(--dsw-alias-border-secondary, currentColor)', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' },
      list: { flex: '1 1 auto', overflowY: 'auto', border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.3))', borderRadius: '8px', minHeight: '120px' },
      row: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderBottom: '1px solid var(--dsw-alias-border-tertiary, rgba(127,127,127,0.16))', cursor: 'pointer' },
      name: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      meta: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
      tag: { fontSize: '10px', padding: '0 5px', borderRadius: '4px', border: '1px solid var(--dsw-alias-border-secondary, currentColor)', color: 'var(--dsw-alias-label-tertiary)' },
      error: { fontSize: '12px', color: 'var(--dsw-alias-label-error, #d33)' },
      empty: { padding: '18px 10px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', textAlign: 'center' },
    };

    /**
     * Render one stored instant.
     * @param value - epoch milliseconds.
     * @returns a short local date and time.
     */
    function formatTime(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '';
      const date = new Date(value);
      const pad = (n) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /**
     * Render a byte count.
     * @param value - size in bytes.
     * @returns a short human size.
     */
    function formatSize(value) {
      const bytes = typeof value === 'number' ? value : 0;
      return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }

    /** The main panel: pick Sessions, then download them as one document. */
    function ExportPanel({ controller, t }) {
      const [, force] = React.useState(0);
      const [selected, setSelected] = React.useState(() => new Set());
      React.useEffect(() => {
        const unsubscribe = controller.subscribe(() => force((n) => n + 1));
        controller.load();
        return unsubscribe;
      }, [controller]);

      const rows = controller.rows;
      const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
      const chosen = rows.filter((row) => selected.has(row.id));

      /**
       * Toggle one row.
       * @param id - the Session id.
       * @returns nothing.
       */
      function toggle(id) {
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      }

      /**
       * Select every row, or clear the selection when all are selected.
       * @returns nothing.
       */
      function toggleAll() {
        setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
      }

      const busy = controller.state.status === 'saving';
      const header = h(
        'div',
        { style: S.head },
        h('div', { style: S.title }, t('panel.title')),
        h('div', { style: S.hint }, t('panel.hint')),
      );

      const bar = h(
        'div',
        { style: S.bar },
        h(
          'button',
          { type: 'button', style: S.button, onClick: toggleAll, disabled: rows.length === 0 },
          allSelected ? t('panel.none') : t('panel.all'),
        ),
        h('span', { style: S.hint }, t('panel.selected', { count: String(chosen.length), total: String(rows.length) })),
        h('span', { style: { flex: '1 1 auto' } }),
        h('button', { type: 'button', style: S.button, onClick: () => controller.load(true) }, t('panel.refresh')),
        h(
          'button',
          {
            type: 'button',
            style: S.primary,
            disabled: busy || chosen.length === 0,
            onClick: () => controller.downloadSelection(chosen),
          },
          busy ? t('panel.working') : t('panel.export', { count: String(chosen.length) }),
        ),
      );

      let body;
      if (controller.listing === 'loading' && rows.length === 0) {
        body = h('div', { style: S.empty }, t('panel.loading'));
      } else if (controller.listing === 'error') {
        body = h('div', { style: S.empty }, h('div', { style: S.error }, t('panel.error', { message: controller.listingError })), h('div', null, t('panel.errorHint')));
      } else if (rows.length === 0) {
        body = h('div', { style: S.empty }, t('panel.empty'));
      } else {
        body = h(
          'div',
          { style: S.list },
          rows.map((row) =>
            h(
              'label',
              { key: row.id, style: S.row, title: row.id },
              h('input', {
                type: 'checkbox',
                checked: selected.has(row.id),
                onChange: () => toggle(row.id),
                style: { margin: 0, cursor: 'pointer' },
              }),
              h('span', { style: S.name }, row.title || row.id),
              row.subagent === true ? h('span', { style: S.tag }, t('panel.subagent')) : null,
              h('span', { style: S.meta }, formatTime(row.updatedAt)),
              h('span', { style: S.meta }, formatSize(row.bytes)),
            ),
          ),
        );
      }

      const status =
        controller.state.status === 'error'
          ? h('div', { style: S.error }, `${t('dock.failed')}: ${controller.state.message}`)
          : controller.state.status === 'saved'
            ? h('div', { style: S.hint }, t('dock.saved'))
            : null;

      return h('div', { style: S.page }, header, bar, body, status);
    }

    /** Sidebar icon for the panel entry. */
    function ExportIcon({ size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M3.5 2.5h6l3 3v8a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z', stroke: 'currentColor', strokeWidth: '1.2', strokeLinejoin: 'round' }),
        h('path', { d: 'M9.5 2.5v3h3', stroke: 'currentColor', strokeWidth: '1.2', strokeLinejoin: 'round' }),
        h('path', { d: 'M8 8.2v3.4M6.6 10.1 8 11.5l1.4-1.4', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    /** Dock button that exports the Session the composer belongs to. */
    function SaveButton({ controller, sessionId, t }) {
      const [state, setState] = React.useState(() => controller.getState());
      React.useEffect(() => controller.subscribe(setState), [controller]);
      const busy = state.status === 'saving';
      const label =
        state.status === 'saved'
          ? t('dock.saved')
          : state.status === 'error'
            ? t('dock.failed')
            : t('dock.label');
      const title = state.status === 'error' ? `${t('dock.failed')}: ${state.message}` : t('dock.hint');
      return h(
        'button',
        {
          type: 'button',
          'aria-busy': busy,
          'aria-label': title,
          title,
          disabled: busy || sessionId === undefined,
          onClick: () => {
            controller.download(String(sessionId ?? ''));
          },
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            height: '24px',
            padding: '0 8px',
            marginRight: '6px',
            fontSize: '12px',
            lineHeight: '24px',
            color: 'var(--dsw-alias-label-secondary)',
            background: 'transparent',
            border: '1px solid var(--dsw-alias-border-secondary, currentColor)',
            borderRadius: '6px',
            cursor: busy ? 'progress' : 'pointer',
            fontFamily: 'inherit',
          },
        },
        h('span', { 'aria-hidden': true, style: { opacity: 0.8 } }, '{}'),
        h('span', null, label),
      );
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        const controller = new ConversationSaveController();
        ctx.provide('conversationSave', controller);
        ctx.effect(
          () => () => {
            controller.disposed = true;
          },
          'conversation-save: controller lifecycle',
        );
        ctx.effect(
          () =>
            ctx.locale.register('conversation-save', {
              zh: {
                meta: {
                  title: '导出对话',
                  description: '勾选工作区里的对话，一次导出为 conversations.json',
                },
                'panel.title': '导出对话',
                'panel.hint': '勾选要导出的对话，生成一个 conversations.json 数组',
                'panel.all': '全选',
                'panel.none': '清除',
                'panel.selected': '已选 {count} / {total}',
                'panel.refresh': '刷新',
                'panel.export': '导出 {count} 个',
                'panel.working': '导出中…',
                'panel.loading': '正在读取对话列表…',
                'panel.empty': '这个工作区还没有对话记录',
                'panel.error': '读取失败：{message}',
                'panel.errorHint': '确认 DSH 运行中，然后点「刷新」重试',
                'panel.subagent': '子会话',
                'dock.label': '存为 JSON',
                'dock.hint': '把当前对话导出为 conversations.json',
                'dock.saved': '已开始下载',
                'dock.failed': '导出失败',
              },
              en: {
                meta: {
                  title: 'Export conversations',
                  description: 'Pick conversations of this workspace and export them as one conversations.json',
                },
                'panel.title': 'Export conversations',
                'panel.hint': 'Pick the conversations to download as one conversations.json array',
                'panel.all': 'Select all',
                'panel.none': 'Clear',
                'panel.selected': '{count} of {total} selected',
                'panel.refresh': 'Refresh',
                'panel.export': 'Export {count}',
                'panel.working': 'Exporting…',
                'panel.loading': 'Reading conversations…',
                'panel.empty': 'This workspace has no conversations yet',
                'panel.error': 'Could not read the list: {message}',
                'panel.errorHint': 'Make sure DSH is running, then select Refresh',
                'panel.subagent': 'subagent',
                'dock.label': 'Save JSON',
                'dock.hint': 'Export this conversation as conversations.json',
                'dock.saved': 'Download started',
                'dock.failed': 'Export failed',
              },
            }),
          'conversation-save: locales',
        );

        ctx.on('command/executed', (sessionId, commandName, result) => {
          if (commandName === 'save' && result?.kind === 'success') controller.download(String(sessionId));
        });

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 200,
              label: () => '导出对话',
            },
            ExportIcon,
          ),
        );

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: 'conversation-save',
            },
            function ConversationSaveMain({ t }) {
              return h(ExportPanel, { controller, t });
            },
          ),
        );

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'conversation-save',
              order: 5,
              locale: 'conversation-save',
              inject: () => ({
                controller,
                sessionId: undefined,
              }),
            },
            function ConversationSaveDock(props) {
              const { controller: owned, t, sessionId } = props;
              return h(SaveButton, { controller: owned, sessionId, t });
            },
          ),
        );
      },
    };
  },
});
