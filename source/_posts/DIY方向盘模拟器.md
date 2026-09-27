---
title: DIY方向盘模拟器
date: 2026-09-27 14:20:28
categories: [教程]
cover: /images/DIY方向盘模拟器/header.png
tags:
---
一个6.5寸平衡车轮毂电机DIY方向盘模拟器的教程
<!-- more -->

## 背景

8月初的时候刷到了力反馈方向盘的视频，看了下正经厂家的产品都在1k往上了，感觉价格有点偏高了。然后翻了下还有DIY的方案，主流有EMC、OpenFFB、FFbeast等方案，EMC项目比较老了；FFbeast教程比较完善，但是不开源，高级版还要付费；OpenFFB倒是比较新，但是相关教程比较少。最终在FFbeast和OpenFFB之间犹豫许久，还是决定用OpenFFB，但是硬件部分尽量参考FFbeast，用6.5寸平衡车轮毂电机为主体，这主要是因为二手轮毂电机够便宜、扭矩大，做方向盘模拟器性价比高。

## 硬件

方向盘模拟器主体一般分为以下几个部分：
1. 电机（6.5寸15 极对[30 极]平衡车轮毂电机,用于提供力反馈方向盘的反向旋转力）
2. 角度编码器（用于记录电机的旋转角度，少数电机有自带编码器，但是开关信号的编码器[比如轮毂电机自带的霍尔编码器]不能用，我用的是mt6701磁性角度编码器[配置为 ABZ 增量模式]）
3. 电机驱动板（如果电机是2根线，一般是有刷电机；轮毂电机是三相线，属于无刷电机，我因为参考的FFbeast,用了可以与OpenFFB通讯的Odrive单电机驱动板）
4. OpenFFB控制板（OpenFFB方案需要，其实如果方案集成度好一点，可以把电机驱动板和控制板合并在一起。参照B站UP关于OpenFFB的视频，用对方提供的STM32F407VGT6和固件）
5. 电源（参照电机要求，我这边电机是36V供电的，所以买的二手明纬36V 350w的开关电源，其实这种36V的轮毂电机用24V的电源也可以，其他电机可以问问AI）
6. 其他零零散散的连接组件，比如线材、12R100w刹车电阻（Odrive控制器上用的）、SN65HVD230 CAN收发器模块（用于Odrive驱动板和OpenFFB控制板通讯）

硬件部分和选择的方案关系很大，
比如如果使用FFbeast方案，其实电路板里面只要Odrive驱动板就行，不需要[OpenFFB控制板]和[SN65HVD230 CAN收发器模块]

另外目前咸鱼上好像已经有支持驱动无刷电机的OpenFFB控制板，也相当于是[电机驱动板]和[控制板]的二合一版本（GaiFFB），理论上可以替代[Odrive单电机驱动板]、[OpenFFB控制板] 和 [SN65HVD230 CAN收发器模块]，但是我没有试过。
![GaiFFB](./images/DIY方向盘模拟器/gaiffb.jpg)

### 硬件连接方式

1. 电机和编码器需要被预处理组装，组装过程需要使用部分3d打印件，参考markerworld的[这个页面](https://makerworld.com/zh/models/3361313-brushless-hub-motor-steering-wheel-simulator-ffbea#profileId-3821850)

2. 电机和编码器组装处理完成后，将电机供电线、编码器、12R100w刹车电阻、开关电源供电线 都按电路板的对应标识连接到[Odrive单电机驱动板]上，
另外把canH/L、3V3线连接到[SN65HVD230 CAN收发器模块]，GND线连接到
![odrive接线](./images/DIY方向盘模拟器/odrive接线.png)

3. [SN65HVD230 CAN收发器模块]的接线部分如下图所示
![230](./images/DIY方向盘模拟器/230.png)

4. [OpenFFB控制板]的接线部分如下图所示
![F407连线](./images/DIY方向盘模拟器/F407连线.png)
![F407正面](./images/DIY方向盘模拟器/F407_0.jpg)


## 软件部分

完成以上硬件部分连线后，需要设置软件部分：

1. Odrive清理历史配置。注意部分Odrive驱动板发货时可能默认被设置过，直接连电机上电会让电机疯转（飞车）产生危险。因此首次设置前可以先断开电机连接线，擦除历史设置，之后再断电重新接上线，然后正常上电。
在终端或命令提示符中通过python安装并运行 `odrivetool`,连接到驱动板之后，执行以下清理命令：
```python
# 擦除 NVM 存储区域的所有配置
odrv0.erase_configuration()

# 板子会自动重启，等待 odrivetool 重新连接上 odrv0
```
2. Odrive需要先完成校准。参考以下哈基米给的代码配置即可：

```python
# === 1. 电源与制动电阻配置 ===
odrv0.config.dc_bus_undervoltage_trip_level = 10.0
odrv0.config.dc_bus_overvoltage_trip_level = 42.0
odrv0.config.brake_resistance = 12.0  # 写入 12.0 欧姆刹车电阻

# === 2. axis0 电机参数 (36V 15极对数毂电机) ===
odrv0.axis0.motor.config.motor_type = 0                  # MOTOR_TYPE_HIGH_CURRENT
odrv0.axis0.motor.config.pole_pairs = 15                  # 15 极对数
odrv0.axis0.motor.config.current_lim = 10.0               # 电流上限 10A
odrv0.axis0.motor.config.calibration_current = 3.0        # 标定电流 3A
odrv0.axis0.motor.config.resistance_calib_max_voltage = 4.0

# === 3. axis0 编码器参数 (MT6701 ABZ 模式，实测 2048 CPR) ===
odrv0.axis0.encoder.config.mode = 0                       # ENCODER_MODE_INCREMENTAL
odrv0.axis0.encoder.config.cpr = 2048                     # 实测 2048 CPR

# 使用 Z 相索引线
odrv0.axis0.encoder.config.use_index = True
# 设置寻 Z 相时的转速（单位：转/秒，设小一点，如 2 转/秒，便于准确抓取 Z 脉冲）
# 寻找 Z 相的方向（1 为顺时针，-1 为逆时针）
odrv0.axis0.config.calibration_lockin.direction = 1

odrv0.axis0.encoder.config.calib_scan_omega = 2.0         # 降低扫描速度，防止突发卡停

# === 4. 控制器安全保护 ===
odrv0.axis0.controller.config.vel_limit = 5.0             # 限制最高转速 5 turns/s
odrv0.axis0.controller.config.vel_limit_tolerance = 2.0 # 允许超过 vel_limit 的 2 倍后报 OVERSPEED 保护

# 保存基础参数
odrv0.save_configuration()
odrv0.reboot()
```
等待重连后，按顺序下发标定并确认标志位：

```python
# 1. 触发电机标定（听 2 秒微弱蜂鸣声）
odrv0.axis0.requested_state = AXIS_STATE_MOTOR_CALIBRATION
# 确认命令, 必须返回 True。
print(odrv0.axis0.motor.is_calibrated)

# 2. 触发寻 Z 相, 电机开始单向慢速旋转。只要 MT6701 的 Z 信号线接线正常，旋转不到一圈就会抓到 Z 脉冲并自动停止
odrv0.axis0.requested_state = AXIS_STATE_ENCODER_INDEX_SEARCH
# 停止后打印确认, 必须返回 True
print("是否找到 Z 相:", odrv0.axis0.encoder.index_found)

# 3. 触发编码器偏置标定（顺时针与逆时针各慢速转一圈）
odrv0.axis0.requested_state = AXIS_STATE_ENCODER_OFFSET_CALIBRATION
# 确认命令, 必须返回 True。
print(odrv0.axis0.encoder.is_ready)

# 确认状态均返回 True 后，锁存预标定标志位并存 Flash
# 1. 标记已被预标定
odrv0.axis0.motor.config.pre_calibrated = True
odrv0.axis0.encoder.config.pre_calibrated = True

# 2. 打印验证（此时必然成功返回 True！）
print("Motor Pre-calibrated:", odrv0.axis0.motor.config.pre_calibrated)
print("Encoder Pre-calibrated:", odrv0.axis0.encoder.config.pre_calibrated)

# 3. 保存并重启
odrv0.save_configuration()
odrv0.reboot()
```



3. 配置 ODrive 开机自动寻零与自动闭环

```python
# 1. 禁用开机电感/相阻标定与偏置扫描（已预标定，不再需要）
odrv0.axis0.config.startup_motor_calibration = False
odrv0.axis0.config.startup_encoder_offset_calibration = False

# 2. 开启开机自动寻找 Z 相 (Index Search)
odrv0.axis0.config.startup_encoder_index_search = True

# 3. 找到 Z 相后，自动切入闭环控制 (Closed Loop)
odrv0.axis0.config.startup_closed_loop_control = True

# 4. 设置安全开机默认控制模式（直驱方向盘推荐：力矩模式，初始力矩 0.0）
odrv0.axis0.controller.config.control_mode = 1  # 1: TORQUE_CONTROL
odrv0.axis0.controller.config.input_mode = 1    # 1: PASSTHROUGH
odrv0.axis0.controller.input_torque = 0.0       # 初始输出力矩归零，安全待命

# 5. 配置 CAN 通讯参数 (Axis0 Node ID = 0)
odrv0.config.enable_can_a = True
odrv0.axis0.config.can_node_id = 0
# 打印当前 CAN 总线配置参数，CAN 总线波特率默认250000，且不允许更改
print(odrv0.can.config)
# 打印 Axis0 的 CAN 配置参数
print(odrv0.axis0.config.can)

# 5. 保存并重启
odrv0.save_configuration()
odrv0.reboot()

```

<pre>
离线上电物理效果验证:

完成上述配置后，可以拔掉Odrive的 USB 数据线（完全离线）：
1.切断 36V 母线电源，等待 ODrive 板上指示灯熄灭。
2.重新接通 36V 电源。
3.观察物理现象：
  上电瞬间，电机自动单向慢速转动不到一圈（触发 MT6701 Z 脉冲）。
  抓到 Z 脉冲后，电机瞬间停止旋转。
  此时 ODrive 已自动切入闭环锁死状态（state == 8），电机力矩待命，无需电脑和 USB 干预！
</pre>

4. 先断开Odrive电源，再开始openFFB设置。
<pre>
将 OpenFFBoard (STM32F407) 通过 USB 插上电脑，打开 OpenFFBoard Configurator 上位机软件。
1. 点击左侧导航栏的 Axis 0（主轴设置）-Motor Driver（电机驱动）：下拉菜单选择 ODrive (CAN)。

2. CAN Baudrate（波特率）：选择 250k（必须与 ODrive 端一致）。

3. Node ID：填入 0（匹配 axis0.config.can.node_id = 0）。

Encoder Source（编码器源）：选择 Driver Encoder（即直接读取 ODrive 通过 CAN 回传的 MT6701 位置数据）。

点击右下角 Save to Flash 保存设置。
</pre>

5. 断开Odrive和openFFB电源。进行初始化联调。
#### 启动与通电顺序 (SOP)

> 由于系统使用带 Z 相的增量式编码器，启动顺序极度严格，**必须绝对遵守**以避免正反馈飞车甩盘：

-  **切断 Odrive 和 OpenFFBoard**: 确保 Odrive 和 STM32F407 的 USB 未插电脑，未供电。
- **飞车预警**： 注意由于我们使用了2：1的齿轮，所以打一圈方向会有2个 Z 脉冲点位，默认上电回中操作会找最近的一个 Z 脉冲点位，但是openffb只识别这2个点位的其中一个，如果恰好上电后是停在另一个点位，会导致方向盘疯转，进入飞车状态。针对这个问题，可以重新全部断电，然后将方向盘转到另一个 Z 脉冲点位附近，然后重复下面的步骤。
-  **ODrive 动力上电**: 保障电机周围没有障碍物，开启 ODrive 的 36V 动力电源。
    *   *现象*: 电机通电后会自动缓慢旋转一小段距离，捕获到 Z 脉冲后瞬间停顿锁死。
-  **连接 OpenFFBoard**: 在电机完全静止后，再插入 OpenFFBoard 的 USB 连接线，小心，此时有可能方向盘疯转，进入飞车状态。
    *   *正常表现现象*: 方向盘呈现带有平顺回中力或阻尼手感的状态。


## 游戏配置

软件设置完成后方向盘能自动回中openFFB接入就完成了，
后续每次重新上电都参考上面第5部分的启动与通电顺序即可。

剩余部分就是参数调整和游戏配置了。

[参数调整](https://github.com/Ultrawipf/OpenFFBoard/wiki/Configurator-guide) 和 [游戏适配性](https://github.com/Ultrawipf/OpenFFBoard/wiki/Games-setup) 请自行参考openFFB的github页面

这边说下我玩过的几个游戏配置：
1.  ACC（神力科莎：竞速）的游戏配置，ACC里面默认识别不到方向盘，转向的绑定需要大幅度打OpenFFB盘子的方向才能识别盘子。
2. 欧卡2：这个比较方便，选项——控制 里面能自动识别到FFBoard,选择 键盘+FFBoard 就行