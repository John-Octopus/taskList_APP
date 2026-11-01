import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import '../models/task.dart';

/// 定时提醒：把「到点」交给系统的 AlarmManager（Android），
/// 由系统在后台弹出通知，不依赖应用一直开着。
///
/// Windows 端没有可用的系统通知实现（详见 pubspec.yaml 里的 dependency_overrides
/// 说明），[isSupported] 为 false，改由界面层的应用内定时器兜底。
class ReminderService {
  ReminderService._();

  static final ReminderService instance = ReminderService._();

  static const String _channelId = 'checklist_reminders';
  static const String _channelName = '任务提醒';

  /// 只有安卓能真正把闹钟交给系统。Windows / Web 走应用内提醒。
  static bool get isSupported => !kIsWeb && Platform.isAndroid;

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();

  bool _initialized = false;
  bool _exactAllowed = true;
  Future<void>? _initFuture;

  bool get initialized => _initialized;

  Future<void> init() => _initFuture ??= _doInit();

  Future<void> _doInit() async {
    if (!isSupported) return;
    try {
      tzdata.initializeTimeZones();
      try {
        final TimezoneInfo info = await FlutterTimezone.getLocalTimezone();
        tz.setLocalLocation(tz.getLocation(info.identifier));
      } catch (_) {
        tz.setLocalLocation(tz.getLocation('Asia/Shanghai'));
      }

      const AndroidInitializationSettings android =
          AndroidInitializationSettings('@mipmap/ic_launcher');
      const WindowsInitializationSettings windows =
          WindowsInitializationSettings(
        appName: '清单',
        appUserModelId: 'com.zcc.checklist_app',
        guid: 'd8e3f0a1-3c2b-4c5d-9e8f-1a2b3c4d5e6f',
      );

      await _plugin.initialize(
        settings: const InitializationSettings(
          android: android,
          windows: windows,
        ),
      );
      _initialized = true;
    } catch (e) {
      debugPrint('ReminderService init failed: $e');
    }
  }

  /// 首次进入时申请通知与精确闹钟权限（Android 13+ / 12+）。
  Future<void> requestPermissions() async {
    if (!isSupported) return;
    await init();
    if (!_initialized) return;
    try {
      final AndroidFlutterLocalNotificationsPlugin? android =
          _plugin.resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();
      if (android == null) return;
      await android.requestNotificationsPermission();
      final bool? exact = await android.requestExactAlarmsPermission();
      _exactAllowed = exact ?? true;
    } catch (e) {
      debugPrint('requestPermissions failed: $e');
    }
  }

  /// 把「未完成 + 有提醒时间 + 时间在未来」的任务全部重新排程。
  ///
  /// 每次都先清空再排，是为了避免编辑/删除后残留旧闹钟；
  /// 任务量级很小，这点开销可以忽略。
  Future<void> sync(List<Task> tasks) async {
    if (!isSupported) return;
    await init();
    if (!_initialized) return;
    try {
      await _plugin.cancelAll();
      final DateTime now = DateTime.now();
      for (final Task task in tasks) {
        final DateTime? at = task.remindAt;
        if (task.done || at == null || !at.isAfter(now)) continue;
        await _schedule(task, at);
      }
    } catch (e) {
      debugPrint('ReminderService.sync failed: $e');
    }
  }

  Future<void> _schedule(Task task, DateTime at) async {
    final tz.TZDateTime when = tz.TZDateTime.from(at, tz.local);
    const NotificationDetails details = NotificationDetails(
      android: AndroidNotificationDetails(
        _channelId,
        _channelName,
        channelDescription: '到点提醒你该做的任务',
        importance: Importance.max,
        priority: Priority.high,
        category: AndroidNotificationCategory.alarm,
        playSound: true,
        enableVibration: true,
        styleInformation: BigTextStyleInformation(''),
      ),
    );

    try {
      await _plugin.zonedSchedule(
        id: notificationId(task.id),
        title: '清单提醒',
        body: task.title,
        scheduledDate: when,
        notificationDetails: details,
        androidScheduleMode: _exactAllowed
            ? AndroidScheduleMode.exactAllowWhileIdle
            : AndroidScheduleMode.inexactAllowWhileIdle,
        payload: task.id,
      );
    } on PlatformException catch (e) {
      // 没拿到精确闹钟权限时会抛 exact_alarms_not_permitted，退回非精确。
      if (e.code == 'exact_alarms_not_permitted') {
        _exactAllowed = false;
        await _plugin.zonedSchedule(
          id: notificationId(task.id),
          title: '清单提醒',
          body: task.title,
          scheduledDate: when,
          notificationDetails: details,
          androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
          payload: task.id,
        );
      } else {
        debugPrint('zonedSchedule failed: $e');
      }
    } catch (e) {
      debugPrint('zonedSchedule failed: $e');
    }
  }

  /// 任务 id 是字符串，通知 id 必须是 32 位整数：用 FNV-1a 做稳定映射。
  static int notificationId(String taskId) {
    int hash = 0x811c9dc5;
    for (final int unit in taskId.codeUnits) {
      hash ^= unit;
      hash = (hash * 0x01000193) & 0x7fffffff;
    }
    return hash;
  }
}
