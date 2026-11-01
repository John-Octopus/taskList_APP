import 'dart:convert';

/// 一条任务。数据本身不可变，修改一律走 [copyWith]，避免列表里出现共享可变状态。
class Task {
  Task({
    required this.id,
    required this.title,
    this.done = false,
    DateTime? createdAt,
    this.completedAt,
    this.remindAt,
  }) : createdAt = createdAt ?? DateTime.now();

  final String id;
  final String title;
  final bool done;
  final DateTime createdAt;
  final DateTime? completedAt;

  /// 定时提醒的触发时刻；null 表示不提醒。
  final DateTime? remindAt;

  Task copyWith({
    String? title,
    bool? done,
    DateTime? completedAt,
    bool clearCompletedAt = false,
    DateTime? remindAt,
    bool clearRemindAt = false,
  }) {
    return Task(
      id: id,
      title: title ?? this.title,
      done: done ?? this.done,
      createdAt: createdAt,
      completedAt: clearCompletedAt ? null : (completedAt ?? this.completedAt),
      remindAt: clearRemindAt ? null : (remindAt ?? this.remindAt),
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'title': title,
        'done': done,
        'createdAt': createdAt.toIso8601String(),
        'completedAt': completedAt?.toIso8601String(),
        'remindAt': remindAt?.toIso8601String(),
      };

  factory Task.fromJson(Map<String, dynamic> json) {
    return Task(
      id: json['id'] as String,
      title: json['title'] as String? ?? '',
      done: json['done'] as bool? ?? false,
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.now(),
      completedAt: DateTime.tryParse(json['completedAt'] as String? ?? ''),
      remindAt: DateTime.tryParse(json['remindAt'] as String? ?? ''),
    );
  }

  String encode() => jsonEncode(toJson());

  static Task? decode(String raw) {
    try {
      return Task.fromJson(Map<String, dynamic>.from(jsonDecode(raw) as Map));
    } catch (_) {
      return null;
    }
  }
}
