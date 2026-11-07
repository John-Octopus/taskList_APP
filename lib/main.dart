import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'pages/home_page.dart';
import 'services/reminder_service.dart';
import 'state/task_store.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final TaskStore store = TaskStore();
  // 先完成读盘再渲染，避免首帧闪一下空列表，也能第一时间拿到夜色模式。
  await store.load();
  // 通知插件初始化要读时区、注册通道，异步做即可；sync() 内部会等它完成。
  ReminderService.instance.init();
  runApp(ChecklistApp(store: store));
}

class ChecklistApp extends StatelessWidget {
  const ChecklistApp({super.key, required this.store});

  final TaskStore store;

  static const Color _seed = Color(0xFF4C6FFF);

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: store,
      builder: (BuildContext context, _) => MaterialApp(
        title: '清单',
        debugShowCheckedModeBanner: false,
        locale: const Locale('zh', 'CN'),
        supportedLocales: const <Locale>[Locale('zh', 'CN'), Locale('en', 'US')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        themeMode: store.themeMode,
        theme: _build(Brightness.light),
        darkTheme: _build(Brightness.dark),
        home: HomePage(store: store),
      ),
    );
  }

  ThemeData _build(Brightness brightness) {
    final ColorScheme colors = ColorScheme.fromSeed(
      seedColor: _seed,
      brightness: brightness,
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: colors,
      scaffoldBackgroundColor: colors.surface,
      appBarTheme: AppBarTheme(
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 0,
        backgroundColor: colors.surface,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w600,
          color: colors.onSurface,
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }
}
