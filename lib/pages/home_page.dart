import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/task.dart';
import '../services/reminder_service.dart';
import '../state/task_store.dart';
import '../utils/time_text.dart';
import '../widgets/shake_detector.dart';
import '../widgets/task_tile.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key, required this.store});

  final TaskStore store;

  @override
  State<HomePage> createState() => _HomePageState();
}

/// 编辑对话框的返回值：标题 + 提醒（null 表示不改，clearReminder 表示清掉）。
class _EditResult {
  const _EditResult({
    required this.title,
    this.remindAt,
    this.clearReminder = false,
  });

  final String title;
  final DateTime? remindAt;
  final bool clearReminder;
}

class _HomePageState extends State<HomePage> {
  final TextEditingController _input = TextEditingController();
  final FocusNode _focus = FocusNode();
  final ScrollController _scroll = ScrollController();

  /// 待添加任务要带的提醒时间（底部输入栏右侧的闹钟按钮设置）。
  DateTime? _pendingRemind;

  /// Windows 没有系统级闹钟，用应用内定时器兜底；fired 记录已弹过的任务。
  final Set<String> _fired = <String>{};
  Timer? _fallbackTimer;
  bool _askingPermission = false;

  @override
  void initState() {
    super.initState();
    if (ReminderService.isSupported) {
      // 安卓：首次启动申请通知/精确闹钟权限，并排程已有提醒。
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        if (_askingPermission) return;
        _askingPermission = true;
        await ReminderService.instance.requestPermissions();
        _syncReminders();
      });
    } else {
      _fallbackTimer =
          Timer.periodic(const Duration(seconds: 15), (_) => _tickFallback());
    }
  }

  @override
  void dispose() {
    _fallbackTimer?.cancel();
    _input.dispose();
    _focus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _syncReminders() {
    ReminderService.instance.sync(widget.store.pending);
  }

  /// 应用内提醒：找出「已到点且没弹过」的任务，弹一个对话框。
  void _tickFallback() {
    if (!mounted) return;
    final DateTime now = DateTime.now();
    for (final Task task in widget.store.pending) {
      final DateTime? at = task.remindAt;
      if (at == null || at.isAfter(now) || _fired.contains(task.id)) continue;
      _fired.add(task.id);
      _showDueDialog(task);
      break;
    }
  }

  void _showDueDialog(Task task) {
    if (!mounted) return;
    SystemSound.play(SystemSoundType.alert);
    showDialog<void>(
      context: context,
      builder: (BuildContext ctx) => AlertDialog(
        icon: const Icon(Icons.alarm_rounded),
        title: const Text('任务提醒'),
        content: Text(task.title),
        actions: <Widget>[
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              widget.store.complete(task.id);
              _syncReminders();
            },
            child: const Text('标记完成'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('知道了'),
          ),
        ],
      ),
    );
  }

  void _submit() {
    final String text = _input.text.trim();
    if (text.isEmpty) return;
    widget.store.add(text, remindAt: _pendingRemind);
    _input.clear();
    setState(() => _pendingRemind = null);
    _syncReminders();
    _focus.requestFocus();
    if (_scroll.hasClients) {
      _scroll.animateTo(
        0,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    }
    HapticFeedback.lightImpact();
  }

  void _deleteWithUndo(Task task) {
    final Task? removed = widget.store.remove(task.id);
    if (removed == null) return;
    _syncReminders();
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text('已删除「${removed.title}」'),
          duration: const Duration(milliseconds: 1800),
          persist: false,
          action: SnackBarAction(
            label: '撤销',
            onPressed: () {
              widget.store.restore(removed);
              _syncReminders();
            },
          ),
        ),
      );
  }

  void _clearCompleted({bool byShake = false}) {
    final List<Task> removed = widget.store.clearCompleted();
    if (removed.isEmpty) {
      if (byShake) HapticFeedback.lightImpact();
      return;
    }
    _syncReminders();
    HapticFeedback.mediumImpact();
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text('已清除 ${removed.length} 个已完成任务'),
          duration: const Duration(milliseconds: 1800),
          persist: false,
          action: SnackBarAction(
            label: '撤销',
            onPressed: () {
              widget.store.restoreAll(removed);
              _syncReminders();
            },
          ),
        ),
      );
  }

  Future<DateTime?> _pickReminder(DateTime? initial) async {
    final DateTime now = DateTime.now();
    final DateTime base = initial ?? now.add(const Duration(hours: 1));
    final DateTime? date = await showDatePicker(
      context: context,
      initialDate: base,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: DateTime(now.year + 5),
      helpText: '选择提醒日期',
    );
    if (date == null || !mounted) return null;
    final TimeOfDay? time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(base),
      helpText: '选择提醒时间',
    );
    if (time == null) return null;
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  Future<void> _editTask(Task task) async {
    final _EditResult? result = await showDialog<_EditResult>(
      context: context,
      builder: (BuildContext ctx) => _TaskEditorDialog(task: task),
    );
    if (result == null || !mounted) return;
    widget.store.update(
      task.id,
      title: result.title,
      remindAt: result.remindAt,
      clearRemindAt: result.clearReminder,
    );
    _fired.remove(task.id);
    _syncReminders();
  }

  Future<void> _pickPendingReminder() async {
    final DateTime? at = await _pickReminder(_pendingRemind);
    if (at == null || !mounted) return;
    setState(() => _pendingRemind = at);
    _focus.requestFocus();
  }

  /// 夜色模式三态的图标与提示。
  static (IconData, String) _themeIcon(ThemeMode mode) => switch (mode) {
        ThemeMode.system => (Icons.brightness_auto_rounded, '跟随系统'),
        ThemeMode.light => (Icons.light_mode_rounded, '亮色'),
        ThemeMode.dark => (Icons.dark_mode_rounded, '深色'),
      };

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.store,
      builder: (BuildContext context, _) {
        final TaskStore store = widget.store;
        final List<Task> pending = store.pending;
        final List<Task> completed = store.completed;
        final ColorScheme colors = Theme.of(context).colorScheme;

        // 扁平化成一条列表：未完成 -> 已完成标题 -> 已完成
        final List<Widget> rows = <Widget>[
          for (final Task t in pending)
            TaskTile(
              key: ValueKey<String>(t.id),
              task: t,
              onTap: () {
                store.toggle(t.id);
                _syncReminders();
              },
              onComplete: () {
                store.complete(t.id);
                _syncReminders();
              },
              onDelete: () => _deleteWithUndo(t),
              onLongPress: () => _editTask(t),
            ),
          if (completed.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 22, 24, 8),
              child: Row(
                children: <Widget>[
                  Text(
                    '已完成 ${completed.length}',
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: colors.outline,
                          letterSpacing: 0.4,
                        ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: Divider(color: colors.outlineVariant)),
                ],
              ),
            ),
          for (final Task t in completed)
            TaskTile(
              key: ValueKey<String>(t.id),
              task: t,
              onTap: () {
                store.reopen(t.id);
                _syncReminders();
              },
              onComplete: () {
                store.complete(t.id);
                _syncReminders();
              },
              onDelete: () => _deleteWithUndo(t),
              onLongPress: () => _editTask(t),
            ),
        ];

        // 夜色模式按钮：跟随系统 -> 亮色 -> 深色 循环。
        final (IconData themeIcon, String themeLabel) =
            _themeIcon(store.themeMode);

        final Widget scaffold = Scaffold(
          appBar: AppBar(
            title: const Text('清单'),
            centerTitle: false,
            actions: <Widget>[
              if (store.totalCount > 0)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: Text(
                      '${store.completedCount}/${store.totalCount}',
                      style: Theme.of(context)
                          .textTheme
                          .titleSmall
                          ?.copyWith(color: colors.outline),
                    ),
                  ),
                ),
              IconButton(
                tooltip: '夜色模式：$themeLabel',
                icon: Icon(themeIcon),
                onPressed: () {
                  store.cycleThemeMode();
                  HapticFeedback.selectionClick();
                },
              ),
              const SizedBox(width: 4),
            ],
          ),
          body: Column(
            children: <Widget>[
              Expanded(
                child: !store.isLoaded
                    ? const Center(child: CircularProgressIndicator())
                    : rows.isEmpty
                        ? const _EmptyState()
                        : ListView.builder(
                            controller: _scroll,
                            padding: const EdgeInsets.only(top: 6, bottom: 12),
                            itemCount: rows.length,
                            itemBuilder: (BuildContext context, int i) =>
                                rows[i],
                          ),
              ),
              if (_pendingRemind != null)
                _PendingReminderBar(
                  at: _pendingRemind!,
                  onClear: () => setState(() => _pendingRemind = null),
                ),
              _InputBar(
                controller: _input,
                focusNode: _focus,
                onSubmit: _submit,
                onPickReminder: _pickPendingReminder,
                hasReminder: _pendingRemind != null,
              ),
            ],
          ),
          // 清扫按钮从标题栏挪到右下角，再抬到输入栏上方，免得压住底部的输入框和「+」。
          floatingActionButton: completed.isEmpty
              ? null
              : Padding(
                  padding: const EdgeInsets.only(bottom: 84),
                  child: FloatingActionButton.extended(
                    onPressed: () => _clearCompleted(),
                    tooltip: ShakeDetector.isSupported
                        ? '清除已完成（也可以摇一摇）'
                        : '清除已完成',
                    icon: const Icon(Icons.cleaning_services_outlined),
                    label: Text('清除 ${completed.length}'),
                  ),
                ),
        );

        // 摇一摇只在有传感器的移动端生效。
        return ShakeDetector.isSupported
            ? ShakeDetector(
                onShake: () => _clearCompleted(byShake: true),
                child: scaffold,
              )
            : scaffold;
      },
    );
  }
}

/// 编辑任务：标题 + 提醒时间。
class _TaskEditorDialog extends StatefulWidget {
  const _TaskEditorDialog({required this.task});

  final Task task;

  @override
  State<_TaskEditorDialog> createState() => _TaskEditorDialogState();
}

class _TaskEditorDialogState extends State<_TaskEditorDialog> {
  late final TextEditingController _title =
      TextEditingController(text: widget.task.title);
  late DateTime? _remindAt = widget.task.remindAt;
  late bool _cleared = false;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final DateTime now = DateTime.now();
    final DateTime base = _remindAt ?? now.add(const Duration(hours: 1));
    final DateTime? date = await showDatePicker(
      context: context,
      initialDate: base,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: DateTime(now.year + 5),
      helpText: '选择提醒日期',
    );
    if (date == null || !mounted) return;
    final TimeOfDay? time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(base),
      helpText: '选择提醒时间',
    );
    if (time == null || !mounted) return;
    setState(() {
      _remindAt = DateTime(date.year, date.month, date.day, time.hour, time.minute);
      _cleared = false;
    });
  }

  void _save() {
    final String text = _title.text.trim();
    if (text.isEmpty) return;
    Navigator.of(context).pop(
      _EditResult(
        title: text,
        remindAt: _remindAt,
        clearReminder: _cleared || _remindAt == null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return AlertDialog(
      title: const Text('修改任务'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          TextField(
            controller: _title,
            autofocus: true,
            maxLength: 200,
            decoration: const InputDecoration(
              labelText: '任务内容',
              counterText: '',
            ),
            onSubmitted: (_) => _save(),
          ),
          const SizedBox(height: 12),
          Row(
            children: <Widget>[
              Icon(
                _remindAt == null
                    ? Icons.alarm_off_rounded
                    : Icons.alarm_rounded,
                size: 20,
                color: colors.outline,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _remindAt == null ? '不提醒' : '提醒 ${formatReminder(_remindAt!)}',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
              TextButton(onPressed: _pick, child: const Text('设置')),
              if (_remindAt != null)
                TextButton(
                  onPressed: () => setState(() {
                    _remindAt = null;
                    _cleared = true;
                  }),
                  child: const Text('清除'),
                ),
            ],
          ),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton(onPressed: _save, child: const Text('保存')),
      ],
    );
  }
}

class _PendingReminderBar extends StatelessWidget {
  const _PendingReminderBar({required this.at, required this.onClear});

  final DateTime at;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 6, 12, 0),
      child: Row(
        children: <Widget>[
          Icon(Icons.alarm_rounded, size: 16, color: colors.primary),
          const SizedBox(width: 6),
          Text(
            '提醒 ${formatReminder(at)}',
            style: TextStyle(fontSize: 12, color: colors.primary),
          ),
          const Spacer(),
          IconButton(
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.close_rounded, size: 16),
            onPressed: onClear,
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(Icons.checklist_rtl_rounded, size: 56, color: colors.outlineVariant),
          const SizedBox(height: 14),
          Text(
            '还没有任务',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(color: colors.outline),
          ),
          const SizedBox(height: 6),
          Text(
            '在下方输入，回车即可添加',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: colors.outline),
          ),
          const SizedBox(height: 26),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(Icons.swipe_right_rounded, size: 16, color: colors.outline),
              const SizedBox(width: 6),
              Text('右滑删除', style: TextStyle(color: colors.outline, fontSize: 12)),
              const SizedBox(width: 18),
              Icon(Icons.swipe_left_rounded, size: 16, color: colors.outline),
              const SizedBox(width: 6),
              Text('左滑完成', style: TextStyle(color: colors.outline, fontSize: 12)),
              const SizedBox(width: 18),
              Icon(Icons.touch_app_rounded, size: 16, color: colors.outline),
              const SizedBox(width: 4),
              Text('长按修改', style: TextStyle(color: colors.outline, fontSize: 12)),
            ],
          ),
        ],
      ),
    );
  }
}

class _InputBar extends StatelessWidget {
  const _InputBar({
    required this.controller,
    required this.focusNode,
    required this.onSubmit,
    required this.onPickReminder,
    required this.hasReminder,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final VoidCallback onSubmit;
  final VoidCallback onPickReminder;
  final bool hasReminder;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(14, 8, 14, 10),
        decoration: BoxDecoration(
          color: colors.surface,
          border: Border(top: BorderSide(color: colors.outlineVariant)),
        ),
        child: Row(
          children: <Widget>[
            Expanded(
              child: TextField(
                controller: controller,
                focusNode: focusNode,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => onSubmit(),
                maxLength: 200,
                decoration: InputDecoration(
                  hintText: '添加任务…',
                  counterText: '',
                  filled: true,
                  fillColor: colors.surfaceContainerHigh,
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 6),
            IconButton(
              tooltip: '设置提醒',
              onPressed: onPickReminder,
              icon: Icon(
                hasReminder
                    ? Icons.alarm_on_rounded
                    : Icons.alarm_add_outlined,
                color: hasReminder ? colors.primary : colors.outline,
              ),
            ),
            const SizedBox(width: 4),
            FilledButton(
              onPressed: onSubmit,
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 16,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              child: const Icon(Icons.add_rounded),
            ),
          ],
        ),
      ),
    );
  }
}
