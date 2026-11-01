import 'package:checklist_app/models/task.dart';
import 'package:checklist_app/pages/home_page.dart';
import 'package:checklist_app/state/task_store.dart';
import 'package:checklist_app/widgets/task_tile.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 界面级回归测试：跑在 flutter_test 的无窗口环境里，
/// 用来确认 1.0.1 的几个新交互（长按编辑、提醒标记、气泡时长、清除已完成）没被改坏。
Future<TaskStore> _pumpHome(WidgetTester tester) async {
  SharedPreferences.setMockInitialValues(<String, Object>{});
  final TaskStore store = TaskStore();
  await store.load();
  await tester.pumpWidget(MaterialApp(home: HomePage(store: store)));
  await tester.pump();
  return store;
}

/// 卸载界面，让 HomePage.dispose 取消兜底定时器，避免测试结束时留下 pending timer。
Future<void> _tearDown(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump();
}

void main() {
  testWidgets('输入框回车能添加任务', (WidgetTester tester) async {
    final TaskStore store = await _pumpHome(tester);

    await tester.enterText(find.byType(TextField), '写作业');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();

    expect(store.pending.length, 1);
    expect(find.text('写作业'), findsOneWidget);

    await _tearDown(tester);
  });

  testWidgets('长按任务弹出编辑框，改标题后生效', (WidgetTester tester) async {
    final TaskStore store = await _pumpHome(tester);
    store.add('旧标题');
    await tester.pump();

    await tester.longPress(find.byType(TaskTile).first);
    await tester.pumpAndSettle();

    expect(find.text('修改任务'), findsOneWidget);
    await tester.enterText(find.byType(TextField).last, '新标题');
    await tester.tap(find.text('保存'));
    await tester.pumpAndSettle();

    expect(store.pending.single.title, '新标题');
    expect(find.text('新标题'), findsOneWidget);

    await _tearDown(tester);
  });

  testWidgets('带提醒的任务在卡片上显示提醒时间', (WidgetTester tester) async {
    final TaskStore store = await _pumpHome(tester);
    final DateTime at = DateTime.now().add(const Duration(hours: 2));
    store.add('交作业', remindAt: at);
    await tester.pump();

    expect(find.byIcon(Icons.alarm_rounded), findsOneWidget);
    expect(store.pending.single.remindAt, isNotNull);

    await _tearDown(tester);
  });

  testWidgets('右滑删除后气泡只停留 1.8 秒', (WidgetTester tester) async {
    final TaskStore store = await _pumpHome(tester);
    store.add('待删除');
    await tester.pump();

    await tester.drag(find.byType(TaskTile).first, const Offset(400, 0));
    await tester.pumpAndSettle();

    final SnackBar bar = tester.widget<SnackBar>(find.byType(SnackBar));
    expect(bar.duration, const Duration(milliseconds: 1800));
    // 带 action 的气泡默认 persist = true（永不自动消失），必须显式关掉。
    expect(bar.persist, isFalse);
    expect(store.totalCount, 0);

    // 等气泡自己消失，别把定时器留到测试结束。
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(find.byType(SnackBar), findsNothing);

    await _tearDown(tester);
  });

  testWidgets('清除已完成会一次性移除已完成任务', (WidgetTester tester) async {
    final TaskStore store = await _pumpHome(tester);
    store.add('A');
    store.add('B');
    await tester.pump();
    store.complete(store.pending.first.id);
    await tester.pump();

    await tester.tap(find.byTooltip('清除已完成'));
    await tester.pumpAndSettle();

    expect(store.completedCount, 0);
    expect(store.pending.length, 1);

    await _tearDown(tester);
  });

  testWidgets('已完成任务点击可恢复', (WidgetTester tester) async {
    final TaskStore store = await _pumpHome(tester);
    store.add('复习');
    await tester.pump();
    store.complete(store.pending.single.id);
    await tester.pump();

    await tester.tap(find.byType(TaskTile).first);
    await tester.pumpAndSettle();

    final Task task = store.pending.single;
    expect(task.done, isFalse);
    expect(task.completedAt, isNull);

    await _tearDown(tester);
  });
}
