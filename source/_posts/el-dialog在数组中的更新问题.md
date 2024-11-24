---
title: el-dialog在数组中的更新问题
tags: vue 2, element-ui
cover: https://th.bing.com/th/id/OIP.IXOC4xuxXLQGvzTWKxJgdAHaGF
---
## 问题表现

公司的项目还在使用 Vue 2 和 element-ui ，在实现功能时发现了一个奇怪的问题，点开弹窗后再更新列表数据，列表数据不展示了。

## 复现问题

原项目组件比较复杂，通过几次尝试，发现通过 watch 可以看到 Vue 是监听到了数据变更的。这就有点奇怪了，如果监听到了数据变化，正常就应该渲染成对应的Dom节点，但是实际并没有，看上去似乎是在实际diff渲染时出现了问题

> PS: 以下均以事后简化复现的示例进行讲解
