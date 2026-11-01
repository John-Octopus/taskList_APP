import 'package:checklist_app/models/task.dart';
import 'package:checklist_app/state/task_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // ignore: invalid_use_of_visible_for_testing_member
  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

  group('TaskStore', () {
    test('添加任务并写入未完成列表', () async {
      final TaskStore store = TaskStore();
      await store.load();
      store.add('买牛奶');
      store.add('   ');
      expect(store.pending.length, 1);
      expect(store.pending.first.title, '买牛奶');
      expect(store.completedCount, 0);
    });

    test('左滑完成：仍在列表里，但归入已完成', () async {
      final TaskStore store = TaskStore();
      await store.load();
      store.add('写周报');
      final String id = store.pending.first.id;
      store.complete(id);
      expect(store.pending, isEmpty);
      expect(store.completed.single.id, id);
      expect(store.completed.single.completedAt, isNotNull);
    });

    test('点击已完成可恢复', () async {
      final TaskStore store = TaskStore();
      await store.load();
      store.add('跑五公里');
      final String id = store.pending.first.id;
      store.complete(id);
      store.reopen(id);
      expect(store.pending.single.id, id);
      expect(store.completed, isEmpty);
    });

    test('右滑删除后可撤销', () async {
      final TaskStore store = TaskStore();
      await store.load();
      store.add('取快递');
      final String id = store.pending.first.id;
      final removed = store.remove(id);
      expect(removed?.id, id);
      expect(store.totalCount, 0);
      store.restore(removed!);
      expect(store.totalCount, 1);
      expect(store.pending.single.id, id);
    });

    test('数据能持久化并重新读回', () async {
      final TaskStore first = TaskStore();
      await first.load();
      first.add('存档测试');
      first.complete(first.pending.first.id);
      // 触发一次异步写盘
      await Future<void>.delayed(const Duration(milliseconds: 50));

      final TaskStore second = TaskStore();
      await second.load();
      expect(second.totalCount, 1);
      expect(second.completed.single.title, '存档测试');
    });

    test('长按编辑可改标题与提醒时间，并能清除提醒', () async {
      final TaskStore store = TaskStore();
      await store.load();
      store.add('准备考试');
      final String id = store.pending.first.id;
      final DateTime at = DateTime(2030, 1, 2, 3, 4);

      store.update(id, title: '准备数学考试', remindAt: at);
      expect(store.byId(id)!.title, '准备数学考试');
      expect(store.byId(id)!.remindAt, at);

      store.update(id, clearRemindAt: true);
      expect(store.byId(id)!.remindAt, isNull);
      expect(store.byId(id)!.title, '准备数学考试');
    });

    test('提醒时间随任务一起持久化', () async {
      final TaskStore first = TaskStore();
      await first.load();
      first.add('交作业');
      final DateTime at = DateTime(2030, 5, 6, 7, 8);
      first.update(first.pending.first.id, remindAt: at);
      await Future<void>.delayed(const Duration(milliseconds: 50));

      final TaskStore second = TaskStore();
      await second.load();
      expect(second.pending.single.remindAt, at);
    });

    test('摇一摇清除已完成可整体撤销', () async {
      final TaskStore store = TaskStore();
      await store.load();
      store.add('A');
      store.add('B');
      for (final Task t in store.pending) {
        store.complete(t.id);
      }
      expect(store.completedCount, 2);

      final List<Task> removed = store.clearCompleted();
      expect(removed.length, 2);
      expect(store.totalCount, 0);

      store.restoreAll(removed);
      expect(store.totalCount, 2);
      expect(store.completedCount, 2);
    });
  });
}
