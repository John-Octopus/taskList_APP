import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:sensors_plus/sensors_plus.dart';

/// 摇一摇手势识别。
///
/// 逻辑：连续两次「加速度明显超过阈值」且间隔 < 700ms 才算一次摇动，
/// 之后冷却 1.2 秒，避免一次抖动触发多次。
/// Windows / 桌面端没有加速度计，直接不订阅，界面自己提供按钮兜底。
///
/// 说明：[isSupported] 在类加载时求值一次。放在静态初始化里是为了让
/// widget 测试环境（Platform 是宿主系统而不是安卓）也能安全判断，
/// 避免误把测试机当成手机去订阅不存在的传感器。
class ShakeDetector extends StatefulWidget {
  const ShakeDetector({
    super.key,
    required this.child,
    required this.onShake,
  });

  final Widget child;
  final VoidCallback onShake;

  static final bool _mobile =
      !kIsWeb && (Platform.isAndroid || Platform.isIOS);

  static bool get isSupported => _mobile;

  @override
  State<ShakeDetector> createState() => _ShakeDetectorState();
}

class _ShakeDetectorState extends State<ShakeDetector> {  /// 2.2g 以上的瞬时冲击视为「一次摇动尖峰」。
  static const double _thresholdG = 2.2;

  StreamSubscription<AccelerometerEvent>? _subscription;
  DateTime? _firstPeakAt;
  DateTime? _lastTriggeredAt;

  @override
  void initState() {
    super.initState();
    if (!ShakeDetector.isSupported) return;
    _subscription = accelerometerEventStream(
      samplingPeriod: SensorInterval.uiInterval,
    ).listen(_onEvent, onError: (Object _) {});
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  void _onEvent(AccelerometerEvent event) {
    final double magnitude = math.sqrt(
          event.x * event.x + event.y * event.y + event.z * event.z,
        ) /
        9.80665;
    if (magnitude < _thresholdG) return;

    final DateTime now = DateTime.now();
    if (_lastTriggeredAt != null &&
        now.difference(_lastTriggeredAt!) < const Duration(milliseconds: 1200)) {
      return;
    }
    if (_firstPeakAt == null ||
        now.difference(_firstPeakAt!) > const Duration(milliseconds: 700)) {
      _firstPeakAt = now;
      return;
    }
    _firstPeakAt = null;
    _lastTriggeredAt = now;
    widget.onShake();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
