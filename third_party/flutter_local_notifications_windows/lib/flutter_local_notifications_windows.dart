// 本地改动：不再按 dart.library.ffi 条件导出真实实现，直接导出纯 Dart 的空实现。
// 真实实现要走 C++/WinRT + ATL，本机 VS Build Tools 没装 ATL（需要管理员权限），
// 编不出来；而它的 registerWith() 一构造实例就 dlopen 同名 dll，导致启动即抛异常、
// 窗口全白。Windows 端的提醒由应用内定时器负责（见 lib/services/reminder_service.dart）。
export 'src/details.dart';
export 'src/msix/stub.dart';
export 'src/plugin/stub.dart';
