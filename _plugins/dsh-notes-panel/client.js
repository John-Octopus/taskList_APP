/**
 * Browser half of dsh-notes-panel.
 *
 * Adds a sidebar entry (order 210, right after the conversation export) and a
 * `main` panel listing this workspace's conversations. Each row can produce a
 * `<window name>.md` note holding what is still unresolved in that conversation.
 *
 * Activation stays import-safe: nothing here throws while the module is being
 * loaded, and the sidebar entry mounts lazily through `ctx.slots.inject`, which
 * only runs once the sidebar's own entry has registered that slot.
 *
 * @module dsh-notes-panel/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-notes-panel',
  factory(require) {
    const React = require('react');
    const hooks = React ?? {};
    const useState = typeof hooks.useState === 'function' ? hooks.useState : (initial) => [typeof initial === 'function' ? initial() : initial, () => {}];
    const useEffect = typeof hooks.useEffect === 'function' ? hooks.useEffect : () => {};
    const useMemo = typeof hooks.useMemo === 'function' ? hooks.useMemo : (factory) => factory();
    const useCallback = typeof hooks.useCallback === 'function' ? hooks.useCallback : (fn) => fn;
    const element = typeof React?.createElement === 'function'
      ? React.createElement.bind(React)
      : () => null;
    const h = element;

    /** Sidebar entry id, which also keys the `main` slot. */
    const PANEL_ID = 'notes-panel';
    /** Host routes, relative so the browser keeps the origin it was served from. */
    const LISTING = 'api/notes-panel/sessions';
    const NOTE = 'api/notes-panel/note';
    const LOCALE_NS = 'notes-panel';

    /**
     * Add a page-relative route prefix to one API path.
     *
     * The desktop shell may serve the Web UI under a base path (`/app/`, ...), in
     * which case a bare `api/...` resolves against the page root and misses the
     * Host route. Deriving the prefix from the current page keeps both cases right.
     *
     * @param path - the route path without a leading slash.
     * @returns the path to fetch.
     */
    function route(path) {
      if (typeof window === 'undefined' || typeof document === 'undefined') return path;
      let base = '/';
      const injected = typeof window.__DSH_BOOT__?.base === 'string' ? window.__DSH_BOOT__.base : '';
      if (injected !== '') {
        base = injected;
      } else {
        const pathname = String(document.baseURI ?? window.location?.href ?? '').split('?')[0];
        base = pathname.endsWith('/') ? pathname : `${pathname.slice(0, pathname.lastIndexOf('/') + 1)}`;
      }
      if (!base.endsWith('/')) base = `${base}/`;
      return new URL(`${base}${path}`, window.location?.href ?? base).toString();
    }

    /** English keys, used when the locale runtime is unavailable. */
    const EN = {
      'meta.title': 'Notes',
      'meta.description': 'Summarize what a conversation has left unresolved into a <window name>.md.',
      'panel.title': 'Notes',
      'panel.hint': 'Pick a conversation to export what it has left unresolved.',
      'panel.loading': 'Reading the conversation list…',
      'panel.empty': 'This workspace has no conversations yet.',
      'panel.failed': 'Could not read the list',
      'panel.refresh': 'Refresh',
      'row.subagent': 'sub',
      'row.action': 'Write note',
      'row.working': 'Summarizing…',
      'row.done': 'Exported',
      'row.failed': 'Failed, try again',
    };

    /** Chinese keys, used when the locale runtime is unavailable. */
    const ZH = {
      'meta.title': '笔记栏',
      'meta.description': '总结某个对话里还没解决的问题，存成「窗口名称.md」。',
      'panel.title': '笔记栏',
      'panel.hint': '选一个对话，导出它还没解决的问题。',
      'panel.loading': '正在读取对话列表…',
      'panel.empty': '这个工作区还没有对话。',
      'panel.failed': '读取失败',
      'panel.refresh': '刷新',
      'row.subagent': '子会话',
      'row.action': '生成笔记',
      'row.working': '正在总结…',
      'row.done': '已导出',
      'row.failed': '生成失败，再试一次',
    };

    /**
     * Translate one key, falling back to the dictionaries above.
     * @param bind - a translator from `ctx.locale.bind`, when available.
     * @param zh - whether the Chinese dictionary applies.
     * @returns the translator.
     */
    function translator(bind, zh) {
      const dictionary = zh ? ZH : EN;
      return (key) => {
        if (typeof bind === 'function') {
          try {
            const text = bind(key);
            if (text !== undefined && text !== null && text !== key) return String(text);
          } catch {
            // Fall through to the bundled dictionary.
          }
        }
        return dictionary[key] ?? key;
      };
    }

    /**
     * Turn a title into the same filename the Host would send.
     * @param title - conversation title.
     * @returns a filesystem-safe basename with a `.md` suffix.
     */
    function noteFilename(title) {
      const raw = String(title ?? '');
      const cleaned = raw
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const clipped = cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned;
      return `${clipped === '' ? 'session' : clipped}.md`;
    }

    /**
     * Report an epoch millisecond stamp as a local date-time.
     * @param stamp - milliseconds since the epoch.
     * @returns text such as `11-01 18:22`, or an empty string.
     */
    function stampText(stamp) {
      const value = Number(stamp);
      if (!Number.isFinite(value) || value <= 0) return '';
      const date = new Date(value);
      const pad = (part) => String(part).padStart(2, '0');
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /** Shared controller: one listing for every mount, one request per session. */
    class NotesController {
      constructor() {
        this.listeners = new Set();
        this.rows = [];
        this.loading = false;
        this.error = undefined;
        this.loaded = false;
        this.active = new Map();
        this.pending = new Set();
      }

      /** Re-render every mount, e.g. after a language switch. */
      refresh() {
        this.publish();
      }

      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }

      publish() {
        for (const listener of this.listeners) {
          try {
            listener();
          } catch {
            // A broken subscriber must not stop the others.
          }
        }
      }

      /** Fetch the workspace session listing. */
      async load(force = false) {
        if (this.loading) return;
        if (this.loaded && !force) return;
        this.loading = true;
        this.error = undefined;
        this.publish();
        try {
          const target = route(LISTING);
          this.target = target;
          const response = await fetch(target, { method: 'GET', headers: { accept: 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
          const body = await response.json();
          this.rows = Array.isArray(body?.sessions) ? body.sessions : [];
          this.cwd = typeof body?.cwd === 'string' ? body.cwd : undefined;
          this.failure = typeof body?.failure === 'string' ? body.failure : undefined;
          this.loaded = true;
        } catch (error) {
          this.error = String(error?.message ?? error);
        } finally {
          this.loading = false;
          this.publish();
        }
      }

      /**
       * Summarize one conversation and save the note.
       * @param row - the session row.
       */
      async note(row) {
        const id = String(row?.id ?? '');
        if (id === '' || this.pending.has(id)) return;
        this.pending.add(id);
        this.active.set(id, 'working');
        this.publish();
        try {
          const response = await fetch(`${route(NOTE)}?sessionId=${encodeURIComponent(id)}`, {
            method: 'GET',
            headers: { accept: 'text/markdown' },
          });
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
          const text = await response.text();
          const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = noteFilename(row?.title);
          anchor.rel = 'noopener';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          this.active.set(id, 'done');
        } catch {
          this.active.set(id, 'failed');
        } finally {
          this.pending.delete(id);
          this.publish();
        }
      }
    }

    /** Sidebar icon: a note page with a folded corner and a check badge. */
    function NotesIcon({ size = 20 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M6 2.75h8.1L19 7.65v13.6H6z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('path', { d: 'M14 2.75v5h5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('path', { d: 'M8.75 12.5h7.5M8.75 16h5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      );
    }

    /**
     * One conversation row.
     * @param props - the row, its state and the actions.
     */
    function NoteRow({ row, state, onNote, t }) {
      const [hover, setHover] = useState(false);
      const busy = state === 'working';
      const sub = row?.subagent === true;
      const caption = useMemo(() => {
        if (state === 'failed') return t('row.failed');
        if (state === 'done') return t('row.done');
        if (busy) return t('row.working');
        return stampText(row?.updatedAt);
      }, [busy, row?.updatedAt, state, t]);
      return h(
        'div',
        {
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px',
            borderRadius: 8,
            background: hover ? 'var(--dsw-alias-bg-hover, rgba(127,127,127,0.08))' : 'transparent',
          },
        },
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--dsw-alias-label-primary, inherit)',
                fontSize: 13,
                lineHeight: '18px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, String(row?.title ?? '')),
            sub
              ? h(
                  'span',
                  {
                    style: {
                      flex: 'none',
                      padding: '0 5px',
                      borderRadius: 4,
                      fontSize: 10,
                      lineHeight: '15px',
                      color: 'var(--dsw-alias-label-tertiary, inherit)',
                      background: 'rgba(127,127,127,0.14)',
                    },
                  },
                  t('row.subagent'),
                )
              : null,
          ),
          h(
            'div',
            {
              style: {
                marginTop: 2,
                fontSize: 11,
                lineHeight: '15px',
                color: state === 'failed' ? 'var(--dsw-alias-danger, #d9534f)' : 'var(--dsw-alias-label-tertiary, inherit)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            },
            caption,
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            disabled: busy,
            onClick: () => onNote(row),
            title: t('row.action'),
            style: {
              flex: 'none',
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.3))',
              background: 'transparent',
              color: 'var(--dsw-alias-label-secondary, inherit)',
              fontSize: 12,
              lineHeight: '16px',
              cursor: busy ? 'progress' : 'pointer',
              opacity: busy ? 0.6 : 1,
            },
          },
          busy ? t('row.working') : t('row.action'),
        ),
      );
    }

    /**
     * The panel body shown in the central `main` area.
     * @param props - the controller and the translation function.
     */
    function NotesPanel({ controller, t }) {
      const [version, setVersion] = useState(0);
      useEffect(() => controller.subscribe(() => setVersion((value) => value + 1)), [controller]);
      useEffect(() => {
        controller.load();
      }, [controller]);
      const onNote = useCallback((row) => controller.note(row), [controller]);
      const rows = controller.rows;
      void version;

      const body = controller.loading && rows.length === 0
        ? h('div', { style: { padding: 16, color: 'var(--dsw-alias-label-tertiary, inherit)', fontSize: 13 } }, t('panel.loading'))
        : rows.length === 0
          ? h('div', { style: { padding: 16, color: 'var(--dsw-alias-label-tertiary, inherit)', fontSize: 13 } }, t('panel.empty'))
          : h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 2, padding: 6 } },
              rows.map((row) =>
                h(NoteRow, {
                  key: String(row?.id ?? ''),
                  row,
                  state: controller.active.get(String(row?.id ?? '')),
                  onNote,
                  t,
                }),
              ),
            );

      /** Everything the listing tells us, so a broken row is diagnosable on screen. */
      const debug = [
        `rows=${rows.length}`,
        `cwd=${String(controller.cwd ?? '?')}`,
        controller.failure === undefined ? '' : `failure=${controller.failure}`,
        controller.error === undefined ? '' : `error=${controller.error}`,
        `url=${String(controller.target ?? '?').slice(-48)}`,
      ].filter((part) => part !== '').join(' | ');

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 14px',
              borderBottom: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.2))',
            },
          },
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h(
              'div',
              { style: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary, inherit)' } },
              t('panel.title'),
            ),
            h(
              'div',
              { style: { marginTop: 2, fontSize: 11, color: 'var(--dsw-alias-label-tertiary, inherit)' } },
              controller.error === undefined ? t('panel.hint') : `${t('panel.failed')}: ${controller.error}`,
            ),
            h('div', { style: { marginTop: 2, fontSize: 10, color: 'var(--dsw-alias-label-tertiary, inherit)' } }, debug),
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: () => controller.load(true),
              disabled: controller.loading,
              style: {
                flex: 'none',
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,0.3))',
                background: 'transparent',
                color: 'var(--dsw-alias-label-secondary, inherit)',
                fontSize: 12,
                lineHeight: '16px',
                cursor: controller.loading ? 'progress' : 'pointer',
              },
            },
            t('panel.refresh'),
          ),
        ),
        h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } }, body),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const controller = new NotesController();
        ctx.provide('notesPanel', controller);

        /** The bound translator, falling back to the bundled dictionaries. */
        let t = translator(undefined, true);
        let language = 'zh';
        try {
          if (typeof ctx.locale?.getSnapshot === 'function') {
            const snapshot = ctx.locale.getSnapshot();
            const active = String(snapshot?.active ?? '');
            if (active !== '') language = active;
          }
          if (typeof ctx.locale?.bind === 'function') t = translator(ctx.locale.bind(LOCALE_NS), /^zh/i.test(language));
          if (typeof ctx.locale?.register === 'function') {
            ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh: ZH, en: EN }), 'notes-panel: locales');
          }
          const rebind = () => {
            try {
              if (typeof ctx.locale?.bind === 'function') t = translator(ctx.locale.bind(LOCALE_NS), /^zh/i.test(language));
            } catch {
              // Keep the current translator.
            }
          };
          ctx.on?.('locale/change', (snapshot) => {
            if (typeof snapshot?.active === 'string' && snapshot.active !== '') language = snapshot.active;
            rebind();
            controller.refresh();
          });
        } catch {
          // Keep the bundled fallback translator.
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 210, label: () => t('meta.title') },
            function NotesPanelIcon({ size }) {
              return h(NotesIcon, { size });
            },
          ),
        );

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, function NotesMain() {
            return h(NotesPanel, { controller, t });
          }),
        );
      },
    };
  },
});
