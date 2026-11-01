import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/task.dart';

/// 全部状态与持久化。界面只读 [pending] / [completed] 并调用这里的方法。
class TaskStore extends ChangeNotifier {
  static const String _storageKey = 'checklist.tasks.v1';

  final List<Task> _tasks = <Task>[];
  final Random _random = Random();
  SharedPreferences? _prefs;
  bool _loaded = false;

  bool get isLoaded => _loaded;

  List<Task> get pending =>
      _tasks.where((Task t) => !t.done).toList(growable: false);

  List<Task> get completed =>
      _tasks.where((Task t) => t.done).toList(growable: false);

  int get totalCount => _tasks.length;

  int get completedCount => _tasks.where((Task t) => t.done).length;

  Task? byId(String id) {
    for (final Task t in _tasks) {
      if (t.id == id) return t;
    }
    return null;
  }

  Future<void> load() async {
    try {
      _prefs = await SharedPreferences.getInstance();
      final String? raw = _prefs!.getString(_storageKey);
      _tasks.clear();
      if (raw != null && raw.isNotEmpty) {
        try {
          final dynamic decoded = jsonDecode(raw);
          if (decoded is List) {
            for (final dynamic item in decoded) {
              final Task? task = item is Map
                  ? Task.fromJson(Map<String, dynamic>.from(item))
                  : null;
              if (task != null && task.title.trim().isNotEmpty) {
                _tasks.add(task);
              }
            }
          }
        } catch (_) {
          // 存档损坏时宁可空列表，也不要让应用起不来。
        }
      }
    } catch (_) {
      // 存档目录不可写等异常：退化为仅内存模式，界面照常可用。
      _prefs = null;
    }
    _sort();
    _loaded = true;
    notifyListeners();
  }

  /// 新任务插到未完成区的最前面。
  void add(String title, {DateTime? remindAt}) {
    final String text = title.trim();
    if (text.isEmpty) return;
    _tasks.insert(0, Task(id: _newId(), title: text, remindAt: remindAt));
    _commit();
  }

  /// 长按编辑：改标题、改/清提醒时间。
  void update(
    String id, {
    String? title,
    DateTime? remindAt,
    bool clearRemindAt = false,
  }) {
    final int i = _tasks.indexWhere((Task t) => t.id == id);
    if (i < 0) return;
    final String? text = title?.trim();
    if (text != null && text.isEmpty) return;
    _tasks[i] = _tasks[i].copyWith(
      title: text,
      remindAt: remindAt,
      clearRemindAt: clearRemindAt,
    );
    _commit();
  }

  /// 左滑：标记完成，保留记录。
  void complete(String id) {
    final int i = _tasks.indexWhere((Task t) => t.id == id);
    if (i < 0 || _tasks[i].done) return;
    _tasks[i] = _tasks[i].copyWith(done: true, completedAt: DateTime.now());
    _commit();
  }

  /// 点一下已完成项：恢复为未完成。
  void reopen(String id) {
    final int i = _tasks.indexWhere((Task t) => t.id == id);
    if (i < 0 || !_tasks[i].done) return;
    _tasks[i] = _tasks[i].copyWith(done: false, clearCompletedAt: true);
    _commit();
  }

  void toggle(String id) {
    final int i = _tasks.indexWhere((Task t) => t.id == id);
    if (i < 0) return;
    _tasks[i].done ? reopen(id) : complete(id);
  }

  /// 右滑：删除，返回被删的条目供撤销使用。
  Task? remove(String id) {
    final int i = _tasks.indexWhere((Task t) => t.id == id);
    if (i < 0) return null;
    final Task removed = _tasks.removeAt(i);
    _commit();
    return removed;
  }

  void restore(Task task) {
    if (_tasks.any((Task t) => t.id == task.id)) return;
    _tasks.add(task);
    _commit();
  }

  void restoreAll(List<Task> tasks) {
    if (tasks.isEmpty) return;
    for (final Task t in tasks) {
      if (!_tasks.any((Task e) => e.id == t.id)) _tasks.add(t);
    }
    _commit();
  }

  /// 清除已完成，返回被清除的条目供撤销使用。
  List<Task> clearCompleted() {
    final List<Task> removed = _tasks.where((Task t) => t.done).toList();
    if (removed.isEmpty) return const <Task>[];
    _tasks.removeWhere((Task t) => t.done);
    _commit();
    return removed;
  }

  /// 未完成在前、已完成在后；组内按创建时间倒序。
  void _sort() {
    _tasks.sort((Task a, Task b) {
      if (a.done != b.done) return a.done ? 1 : -1;
      return b.createdAt.compareTo(a.createdAt);
    });
  }

  void _commit() {
    _sort();
    notifyListeners();
    _persist();
  }

  Future<void> _persist() async {
    final String data =
        jsonEncode(_tasks.map((Task t) => t.toJson()).toList());
    try {
      await _prefs?.setString(_storageKey, data);
    } catch (_) {
      // 写盘失败不影响本次操作，下次启动仍会重新尝试。
    }
  }

  String _newId() =>
      '${DateTime.now().microsecondsSinceEpoch}-${_random.nextInt(1 << 20)}';
}
