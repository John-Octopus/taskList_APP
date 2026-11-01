import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/task.dart';
import '../utils/time_text.dart';

/// 单条任务卡片，自己处理横向拖拽：
/// 右滑超过阈值 -> 删除；左滑超过阈值 -> 完成；不足阈值 -> 弹回原位。
class TaskTile extends StatefulWidget {
  const TaskTile({
    super.key,
    required this.task,
    required this.onComplete,
    required this.onDelete,
    required this.onTap,
    this.onLongPress,
  });

  final Task task;
  final VoidCallback onComplete;
  final VoidCallback onDelete;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  @override
  State<TaskTile> createState() => _TaskTileState();
}

class _TaskTileState extends State<TaskTile>
    with SingleTickerProviderStateMixin {
  late final AnimationController _anim = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 220),
  );

  double _dx = 0;
  double _from = 0;
  double _to = 0;
  bool _armed = false;

  @override
  void initState() {
    super.initState();
    _anim.addListener(() {
      setState(() {
        _dx = _from + (_to - _from) * Curves.easeOutCubic.transform(_anim.value);
      });
    });
  }

  @override
  void dispose() {
    _anim.dispose();
    super.dispose();
  }

  void _animateTo(double target, {VoidCallback? then}) {
    _from = _dx;
    _to = target;
    _anim
      ..stop()
      ..value = 0
      ..forward().whenCompleteOrCancel(() {
        if (!mounted) return;
        if (then != null) {
          then();
        } else {
          setState(() => _dx = target);
        }
      });
  }

  void _onDragUpdate(DragUpdateDetails details, double maxSwipe) {
    if (_anim.isAnimating) return;
    setState(() {
      _dx = (_dx + details.delta.dx).clamp(-maxSwipe, maxSwipe);
    });
    final bool armed = _dx.abs() > maxSwipe * 0.42;
    if (armed != _armed) {
      _armed = armed;
      if (armed) HapticFeedback.selectionClick();
    }
  }

  void _onDragEnd(DragEndDetails details, double maxSwipe) {
    final double v = details.velocity.pixelsPerSecond.dx;
    final bool flung = v.abs() > 700;
    final bool past = _dx.abs() > maxSwipe * 0.42;
    _armed = false;

    if (_dx > 0 && (past || (flung && v > 0))) {
      // 右滑 -> 删除：飞出去再真正移除
      _animateTo(
        MediaQuery.of(context).size.width,
        then: widget.onDelete,
      );
      return;
    }
    if (_dx < 0 && (past || (flung && v < 0))) {
      // 左滑 -> 完成：飞出后回落，让它在“已完成”区重新出现
      _animateTo(
        -MediaQuery.of(context).size.width,
        then: () {
          widget.onComplete();
          if (!mounted) return;
          setState(() => _dx = 0);
        },
      );
      return;
    }
    _animateTo(0);
  }

  @override
  Widget build(BuildContext context) {
    final Task task = widget.task;

    final double progress = (_dx.abs() / 120).clamp(0.0, 1.0);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
      child: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final double maxSwipe = constraints.maxWidth;
          return GestureDetector(
            onHorizontalDragUpdate: (DragUpdateDetails d) =>
                _onDragUpdate(d, maxSwipe),
            onHorizontalDragEnd: (DragEndDetails d) => _onDragEnd(d, maxSwipe),
            child: Stack(
              clipBehavior: Clip.none,
              children: <Widget>[
                // 右滑露出的红色删除底
                Positioned.fill(
                  child: _SwipeBackground(
                    color: Colors.red.shade600,
                    alignment: Alignment.centerLeft,
                    icon: Icons.delete_outline_rounded,
                    label: '删除',
                    opacity: _dx > 0 ? progress : 0,
                  ),
                ),
                // 左滑露出的绿色完成底
                Positioned.fill(
                  child: _SwipeBackground(
                    color: Colors.green.shade600,
                    alignment: Alignment.centerRight,
                    icon: Icons.check_rounded,
                    label: '完成',
                    opacity: _dx < 0 ? progress : 0,
                  ),
                ),
                Transform.translate(
                  offset: Offset(_dx, 0),
                  child: _Card(
                    task: task,
                    onTap: widget.onTap,
                    onLongPress: widget.onLongPress,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({
    required this.task,
    required this.onTap,
    required this.onLongPress,
  });

  final Task task;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme colors = theme.colorScheme;
    final bool done = task.done;
    final DateTime? remindAt = task.remindAt;
    final bool overdue = remindAt != null && remindAt.isBefore(DateTime.now());

    return Material(
      color: done
          ? colors.surfaceContainerHighest.withValues(alpha: 0.55)
          : colors.surfaceContainerHigh,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          child: Row(
            children: <Widget>[
              Icon(
                done
                    ? Icons.check_circle_rounded
                    : Icons.radio_button_unchecked_rounded,
                size: 22,
                color: done ? colors.primary : colors.outline,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      task.title,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyLarge?.copyWith(
                        color: done ? colors.outline : colors.onSurface,
                        decoration: done ? TextDecoration.lineThrough : null,
                        decorationColor: colors.outline,
                      ),
                    ),
                    if (remindAt != null && !done) ...<Widget>[
                      const SizedBox(height: 4),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Icon(
                            overdue
                                ? Icons.alarm_off_rounded
                                : Icons.alarm_rounded,
                            size: 14,
                            color: overdue ? colors.error : colors.primary,
                          ),
                          const SizedBox(width: 5),
                          Text(
                            formatReminder(remindAt),
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: overdue ? colors.error : colors.primary,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 滑动时垫在卡片底下的彩色层，只是视觉提示，不接收手势。
class _SwipeBackground extends StatelessWidget {
  const _SwipeBackground({
    required this.color,
    required this.alignment,
    required this.icon,
    required this.label,
    required this.opacity,
  });

  final Color color;
  final Alignment alignment;
  final IconData icon;
  final String label;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    final bool isLeft = alignment == Alignment.centerLeft;
    return Opacity(
      opacity: opacity,
      child: Container(
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(14),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 20),
        alignment: alignment,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          textDirection: isLeft ? TextDirection.ltr : TextDirection.rtl,
          children: <Widget>[
            Icon(icon, color: Colors.white, size: 22),
            const SizedBox(width: 8),
            Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
