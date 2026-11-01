/// 提醒时间的中文短描述，例如「今天 18:30」「明天 09:00」。
String formatReminder(DateTime at, {DateTime? now}) {
  final DateTime ref = now ?? DateTime.now();
  final DateTime today = DateTime(ref.year, ref.month, ref.day);
  final DateTime day = DateTime(at.year, at.month, at.day);
  final String time =
      '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';

  switch (day.difference(today).inDays) {
    case 0:
      return '今天 $time';
    case 1:
      return '明天 $time';
    case -1:
      return '昨天 $time';
    case 2:
      return '后天 $time';
  }
  if (at.year == ref.year) {
    return '${at.month}月${at.day}日 $time';
  }
  final String month = at.month.toString().padLeft(2, '0');
  final String date = at.day.toString().padLeft(2, '0');
  return '${at.year}-$month-$date $time';
}
