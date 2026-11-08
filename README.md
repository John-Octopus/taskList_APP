# 清单 · ChecklistApp

安卓 / Windows 双端待办清单，一份 Dart 代码两端运行。当前版本 **1.0.2**。

- 输入任务：底部输入框回车或点 + 添加；输入栏的闹钟按钮可以顺手定个提醒
- **左滑 = 完成**（完成的任务进"已完成"区，仍保留，可点击恢复）
- **右滑 = 删除**（气泡停留 1.8 秒，带"撤销"）
- **长按 = 修改**：改标题、加/改/清除提醒
- **摇一摇 = 清空已完成**（安卓；Windows 无加速度计，用右上角扫帚按钮）
- 定时提醒：到点弹系统通知（安卓）。应用没在前台也能收到
- 数据存本地（shared_preferences），重启不丢

## 已构建产物

| 平台 | 位置 | 说明 |
| --- | --- | --- |
| Android | `dist/清单-1.0.2.apk` | release 包，直接装到平板 |
| Windows | `dist/ChecklistApp-windows/` | 整个文件夹拷走，双击 `清单.exe`；`data` 与 dll 必须同目录 |

## 运行

```powershell
flutter run -d windows     # 桌面调试（热重载）
flutter run -d <设备id>    # 安卓真机调试
flutter test               # 14 个测试（8 数据层 + 6 界面层）
```

## 手势与交互

`lib/widgets/task_tile.dart`：自写拖拽（不用 `Dismissible`，因为"完成"不能真删）。

- 拖动超过卡片宽度 42% 或甩动速度 > 700 触发
- 右滑：卡片飞出屏幕右侧 → 删除（可撤销）
- 左滑：飞出左侧 → 标记完成并回弹归位
- 长按：弹出编辑对话框（标题 + 提醒时间）

## 提醒的工作方式

- 安卓：`flutter_local_notifications` 走 `AlarmManager` 精确闹钟 + 通知渠道 `checklist_reminders`
  - 需要 `POST_NOTIFICATIONS`（安卓 13+）和 `SCHEDULE_EXACT_ALARM`（安卓 12+）权限，首次启动会申请
  - 被系统拒绝精确闹钟时自动降级为非精确调度（可能延迟几分钟）
  - 开机后由 `ScheduledNotificationBootReceiver` 重新排程
- Windows：没有系统级闹钟 API，用应用内定时器（15 秒轮询）+ 对话框提醒，**只在程序运行时有效**
  - 本地 `third_party/flutter_local_notifications_windows` 是去掉了原生实现的副本：上游实现依赖 ATL，本机 VS Build Tools 没装 ATL，编译不过

## 代码结构

```
lib/main.dart                    入口 + 主题（Material 3，种子色 #4C6FFF）
lib/models/task.dart             Task 模型（id/title/done/createdAt/completedAt/remindAt）
lib/state/task_store.dart        ChangeNotifier：增删改查 + 本地持久化
lib/services/reminder_service.dart  提醒排程（安卓精确闹钟，Windows 空实现）
lib/utils/time_text.dart         "今天 18:30" 这类时间文案
lib/pages/home_page.dart         列表页、编辑对话框、输入栏、撤销 SnackBar、兜底提醒
lib/widgets/task_tile.dart       卡片 + 滑动手势 + 长按 + 提醒标记
lib/widgets/shake_detector.dart  加速度计摇一摇识别
third_party/flutter_local_notifications_windows/  去掉原生实现的本地副本
```

存储键 `checklist.tasks.v1`，JSON 数组；读盘失败自动退化为内存模式，界面不会卡住。

## 本机工具链（均装在 E 盘）

| 组件 | 路径 |
| --- | --- |
| Flutter 3.47.9 / Dart 3.13.7 | `E:\dev\flutter` |
| Android SDK 36 + build-tools 36 + NDK 28 | `E:\dev\android-sdk` |
| JDK 21 (Temurin) | `E:\dev\jdk\jdk-21.0.13+9` |
| MinGW-w64 g++ 16.2.0 (UCRT) | `E:\mingw64`（与 Flutter 无关，写 C++ 用） |
| VS Build Tools 2022 + MSVC 14.44（Windows 端编译必需，**缺 ATL 组件**） | `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools` |

用户环境变量已持久化：`JAVA_HOME`、`ANDROID_HOME`、`ANDROID_SDK_ROOT`、`FLUTTER_STORAGE_BASE_URL`。

## 国内镜像（已写进项目配置）

- Gradle 分发包：腾讯云镜像（`android/gradle/wrapper/gradle-wrapper.properties`）
- Maven：阿里云 google / public / gradle-plugin + 腾讯 nexus（`android/settings.gradle.kts`、`android/build.gradle.kts`）
- pub：`PUB_HOSTED_URL=https://pub.flutter-io.cn`
---

> 🐟 本仓库由**大肥鱼**（一只在 DeepSeek Harness 里住着的鱼）负责打理。提交、发版、清垃圾、偶尔翻车再修好，都是它干的。有问题就喊「咕噜」。

