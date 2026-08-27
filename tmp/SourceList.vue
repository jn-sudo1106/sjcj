<template>
  <a-card :bordered="false">
    <a-row :gutter="2">
      <a-col :span="showCategory? 4 : 0">
        <category-tree
          @node-click="treeClick"
          @node-check="treeCheck"
        />
      </a-col>
      <a-col :span="showCategory? 20 : 24">
        <div>
          <SourceSearchNotify @refresh="first => handleRefresh(first)" :queryParam="queryParam" :freqSum="freqSum"></SourceSearchNotify>
          <SourceSearch @refresh="first => handleRefresh(first)" :queryParam="queryParam"></SourceSearch>
          <div class="table-operator">
            <a-button @click="showCategory = !showCategory" size="small" style="margin-left: -3px;"><a-icon :type="showCategory ? 'left' : 'right'" /></a-button>
            <a-button type="primary" icon="play-square" @click="sendBatch" style="margin-left: 8px">发抓取</a-button>
            <a-button icon="experiment" @click="sendBatchTest" style="margin-left: 8px">发指定队列</a-button>
            <a-button icon="build" @click="sendConfigBatch" style="margin-left: 8px">发配置</a-button>
            <a-dropdown v-action:edit>
              <a-menu slot="overlay">
                <a-sub-menu key="m3" title="状态调整">
                  <a-menu-item key="70" @click="handleState(null, 'C')">
                    <a-icon type="check"/>
                    改为成功状态
                  </a-menu-item>
                  <a-menu-item key="3" @click="batchChangeEnable(0)">
                    <a-icon type="thunderbolt" />
                    启用
                  </a-menu-item>
                  <a-menu-item key="5" @click="batchChangeEnable(1)">
                    <a-icon type="disconnect" />
                    禁用
                  </a-menu-item>
                  <a-menu-item key="50" @click="deleteBatch()">
                    <a-icon type="scissor"/>
                    删除
                  </a-menu-item>
                </a-sub-menu>
                <a-sub-menu key="m4" title="批量定时">
                  <a-menu-item key="100" @click="showCron()">
                    <a-icon type="clock-circle"/>
                    查询定时列表
                  </a-menu-item>
                  <a-menu-item key="10" @click="configCron()">
                    <a-icon type="clock-circle"/>
                    批量配定时
                  </a-menu-item>
                </a-sub-menu>
                <a-sub-menu key="m5" title="批量修改">
                  <a-menu-item key="30" @click="handleCopySnatchOpen(true)">
                    <a-icon type="block"/>
                    批量更改配置
                  </a-menu-item>
                  <a-menu-item key="40" @click="visibleCategory = true">
                    <a-icon type="tag"/>
                    批量更改目录
                  </a-menu-item>
                  <a-menu-item key="90" @click="handleAuthSetOpen(true)">
                    <a-icon type="windows" />
                    设要求登陆
                  </a-menu-item>
                  <a-menu-item key="91" @click="handleClearAuth()">
                    <a-icon type="minus" />
                    清除登陆要求
                  </a-menu-item>
                  <a-menu-item key="80" @click="handleKeep(null, 1)">
                    <a-icon type="retweet" />
                    设断点续传
                  </a-menu-item>
                  <a-menu-item key="81" @click="handleKeep(null, 0)">
                    <a-icon type="dash" />
                    取消断点续传
                  </a-menu-item>
                </a-sub-menu>
                <a-sub-menu key="m6" title="设颜色标识">
                  <a-menu-item v-for="c in colors" :key="c.key" @click="handleMarkSource(c.key)">
                    <a-badge :color="c.code" :text="c.text" />
                  </a-menu-item>
                  <a-menu-item @click="handleClearMark()">
                    <a-icon type="star"/>清除标记
                  </a-menu-item>
                </a-sub-menu>
                <a-sub-menu key="m7" title="网站关联">
                  <a-menu-item key="710" @click="handleBindSiteOpen()">
                    <a-icon type="global"/>批量更改归属网站
                  </a-menu-item>
                </a-sub-menu>
                <a-menu-item key="300" title="打标签" @click="handleMarkTags()">
                  <a-icon type="tag"/>源打标签
                </a-menu-item>
                <!--                <a-menu-item key="200" @click="showSteps()">-->
                <!--                  <a-icon type="branches"/>-->
                <!--                  查询子任务-->
                <!--                </a-menu-item>-->
              </a-menu>
              <a-button style="margin-left: 8px" icon="setting">
                操作类
                <a-icon type="down"/>
              </a-button>
            </a-dropdown>
            <a-dropdown v-action:edit>
              <a-menu slot="overlay">
                <a-sub-menu key="s1" title="频率标识">
                  <a-menu-item v-for="c in freqColors" :key="c.key" @click="batchMark(c.key)">
                    <a-badge :color="c.code" :text="c.text" />
                  </a-menu-item>
                  <a-menu-item @click="batchMark('NONE')">
                    <a-icon type="eye-invisible" />清除频率
                  </a-menu-item>
                </a-sub-menu>
                <a-menu-item @click="batchMark(null, 0)">
                  <a-icon type="check-circle" />人工核验已正常
                </a-menu-item>
                <a-menu-item @click="batchMark(null, 1)">
                  <a-icon type="warning" />人工标为异常
                </a-menu-item>
              </a-menu>
              <a-button style="margin-left: 8px" icon="eye">
                监控类
                <a-icon type="down"/>
              </a-button>
            </a-dropdown>
            <a-dropdown v-action:edit>
              <a-menu slot="overlay">
                <a-menu-item key="400" @click="sendCategory()" v-if="queryParam.categorys">
                  <a-icon type="right-circle"/>
                  按目录发送
                </a-menu-item>
                <a-menu-item key="450" @click="batchClear()" v-if="selectedRowKeys.length > 0">
                  <a-icon type="strikethrough"></a-icon>
                  清除缓存
                </a-menu-item>
                <a-menu-item key="500" @click="markSourcesDev()">
                  <a-icon type="pushpin"/>
                  批量源标识
                </a-menu-item>
                <a-menu-item key="600" @click="fetchBaseInfo()">
                  <a-icon type="profile"/>
                  提取源名称与URL
                </a-menu-item>
                <a-menu-item key="700" @click="runMeasure()">
                  <a-icon type="gateway"/>
                  运行指标
                </a-menu-item>
                <a-menu-item key="800" @click="handleBatchRemark()">
                  <a-icon type="file-text"/>
                  批量备注
                </a-menu-item>
              </a-menu>
              <a-button style="margin-left: 8px">
                工具
                <a-icon type="down"/>
              </a-button>
            </a-dropdown>

            <span style="float:right;">
              <a-checkbox v-model="queryParam.groupBy" @change="handleRefresh(true)">
                同类型源仅展示一条
              </a-checkbox>
              <a-divider type="vertical" />
              <a-button icon="plus" @click="handleOpenBuild">新建源</a-button>
              <a-button @click="batchAdd">批量导入</a-button>
              <!--<a-button icon="global" @click="batchAdd2">导入新闻站</a-button>-->
            </span>
          </div>
          <u-table
            ref="sourceTable"
            size="small"
            :data="oriData"
            row-key="sourceId"
            :row-class-name="getRowClass"
            :expand-config="{expandAll: false, lazy: true}"
            @expand-change="handleExpandChange"
            big-data-checkbox
            :height="height"
            style="width: 100%"
            use-virtual
            header-drag-style
            showBodyOverflow="title"
            showHeaderOverflow="title"
            :row-height="rowHeight"
            :pagination-show="true"
            :total="pageForm.total"
            :page-size="pageForm.pageSize"
            :page-sizes="[20, 40, 100, 200, 300]"
            :current-page="pageForm.pageNo"
            @selection-change="handleSelectionChange"
            @handlePageSize="handlePageSize"
            @sort-change="handleSortChange"
          >
            <template slot="empty">
              没有查询到符合条件的记录
            </template>
            <u-table-column type="selection" width="40" fixed="left" />
            <u-table-column type="expand" width="30">
              <template slot-scope="{ row }">
                <div class="sub-table-wrapper">
                  <a-spin :spinning="!!childLoadingMap[row.sourceId]">
                    <div class="child-content-area">
                      <div v-if="childDataMap[row.sourceId] && childDataMap[row.sourceId].length > 0" style="margin: -20px -50px -20px -50px;">
                        <u-table
                          ref="childTable"
                          :data="childDataMap[row.sourceId]"
                          size="small"
                          :show-header="true"
                          :row-height="rowHeight2"
                          style="width: 100%; border: none; margin-left: 115px;"
                        >
                          <u-table-column prop="sourceName" label="步骤ID" width="180" :show-overflow-tooltip="false">
                            <template slot-scope="scope">
                              <span>[{{ scope.row.stepId }}]-{{ scope.row.stepName }}</span>
                            </template>
                          </u-table-column>
                          <u-table-column prop="configId" label="步骤配置" width="100">
                            <template slot-scope="scope">
                              <span @click="handleShowConfig(scope.row.configId)" style="text-decoration: underline; cursor: pointer;">
                                {{ scope.row.configId }}
                              </span>
                            </template>
                          </u-table-column>
                          <u-table-column prop="entryTypeName" label="子表" width="170" :show-overflow-tooltip="true">
                            <template slot-scope="scope">
                              <div @click="handleShowEntryType(scope.row.outEntry)" style="text-decoration: underline; cursor: pointer;">
                                <a-tag color="#2db7f5">{{ scope.row.entryTypeName }}</a-tag>
                              </div>
                            </template>
                          </u-table-column>
                          <u-table-column prop="dataCnt" label="数据量" width="120">
                            <template slot-scope="scope">
                              <div @click="handleShowData2(row.sourceId, scope.row.outEntry)" style="text-align: center;">
                                <a-tag v-if="scope.row.dataCnt && scope.row.dataCnt >= 0" style="min-width: 55px; text-align: center; color: #c41d7f; cursor: pointer;">
                                  {{ scope.row.dataCnt || '-' }}</a-tag>
                                <span v-else>-</span>
                              </div>
                            </template>
                          </u-table-column>
                          <u-table-column prop="lastInsert" label="新入" width="80">
                            <template slot-scope="scope">
                              <div @click="handleLogs(scope.row)">
                                <a-tooltip placement="topLeft" :title="scope.row.lastInsert" :mouseEnterDelay="0.5">
                                  <span style="text-decoration: none; cursor: pointer; padding-left: 2px;">
                                    <a style="color: #ff4d4f; font-size: 12px;" v-if="scope.row.notifyFlag === 1">
                                      <a-icon type="warning" />
                                    </a>
                                  </span>
                                  <span>
                                    {{ scope.row.lastInsert | timeago }}
                                  </span>
                                </a-tooltip>
                              </div>
                            </template>
                          </u-table-column>
                          <u-table-column prop="lastUpdate" label="更新" width="80">
                            <template slot-scope="scope">
                              <div @click="handleLogs(scope.row)">
                                <a-tooltip placement="topLeft" :title="scope.row.lastInsert" :mouseEnterDelay="0.5">
                                  <span style="text-decoration: none; cursor: pointer; padding-left: 2px;">
                                    <a style="color: #ff4d4f; font-size: 12px;" v-if="scope.row.notifyFlag === 1">
                                      <a-icon type="warning" />
                                    </a>
                                  </span>
                                  <span>
                                    {{ scope.row.lastUpdate | timeago }}
                                  </span>
                                </a-tooltip>
                              </div>
                            </template>
                          </u-table-column>
                          <u-table-column prop="tableName" label="物理表" width="220" :show-overflow-tooltip="true">
                            <template slot-scope="scope">
                              <span>{{ scope.row.tableName && scope.row.tableName.replace('sense_data.', '')}}</span>
                            </template>
                          </u-table-column>
                          <u-table-column prop="outEntry" label="表ID" width="100" :show-overflow-tooltip="false">
                            <template slot-scope="scope">
                              <div @click="handleShowEntryType(scope.row.outEntry)" style="text-decoration: underline; cursor: pointer;">
                                {{ scope.row.outEntry }}
                              </div>
                            </template>
                          </u-table-column>
                          <u-table-column prop="sourceName" label="配置名" width="180" :show-overflow-tooltip="false">
                            <template slot-scope="scope">
                              <span>[配置]{{ scope.row.configName }}</span>
                            </template>
                          </u-table-column>
                        </u-table>
                      </div>
                    </div>
                  </a-spin>
                </div>
              </template>
            </u-table-column>
            <u-table-column prop="sourceId" label="源ID" width="130" :sortable="'custom'">
              <template slot-scope="scope">
                <a-badge v-if="scope.row.usedFlag && scope.row.usedFlag !== 0" :color="colors[scope.row.usedFlag - 1].code"/>
                <span v-if="scope.row.isDelete === 0">{{ scope.row.sourceId }}</span>
                <a-tag v-if="scope.row.isDelete !== 0" color="#f50" title="已停用的源">{{ scope.row.sourceId }}</a-tag>
                <span style="text-decoration: none; cursor: pointer; padding-left: 2px;">
                  <a style="color: #108ee9; font-size: 11px;" v-if="scope.row.authConfig" @click="handleConfigDetail(scope.row.authConfig)">登</a>
                </span>
                <span style="text-decoration: none; cursor: pointer; padding-left: 2px;">
                  <a style="color: #108ee9; font-size: 11px;" v-if="scope.row.keepLast === 1" @click="handleShowLastUrl(scope.row)">续</a>
                </span>
              </template>
            </u-table-column>
            <u-table-column prop="sourceName" label="源名称" width="150" :sortable="'custom'" :show-overflow-tooltip="false">
              <template slot-scope="scope">
                <span v-if="scope.row.schedule" style="cursor: pointer; overflow: hidden; float: left; position: absolute; left: 1px; top: -6px;" @click="handleDetail(scope.row)">
                  <span style="text-decoration: none; cursor: pointer;">
                    <a style="color: red; font-size: 11px;">
                      {{ scope.row.schedule | freqFilter }}
                    </a>
                  </span>
                </span>
                <span style="padding-left: 3px;">
                  <span v-if="scope.row.state === 'E'" class="name-class class-err" @click="handleDetail(scope.row)">
                    {{ scope.row.sourceName }}
                  </span>
                  <span v-else class="name-class" @click="handleDetail(scope.row)">
                    {{ scope.row.sourceName }}
                  </span>
                </span>
              </template>
            </u-table-column>
            <u-table-column prop="sourceUrl" label="URL">
              <template slot-scope="scope">
                <a rel="noreferrer noopener nofollow" :href="scope.row.sourceUrl" target="_blank" :title="scope.row.sourceUrl"> {{ scope.row.sourceUrl }}</a>
              </template>
            </u-table-column>
            <u-table-column prop="configId" label="配置ID" width="90" sortable>
              <template slot-scope="scope">
                <span @click="handleShowConfig(scope.row.configId)" style="text-decoration: underline; cursor: pointer;">
                  {{ scope.row.configId }}
                </span>
                <span @click="handleConfigDetail(scope.row.configId)" v-if="scope.row.paramCnt > 0" style="color: red; font-size: 11px; cursor: pointer; border:solid 1px red;">
                  参
                </span>
              </template>
            </u-table-column>
            <u-table-column prop="dataCnt" label="数据" width="80" sortable>
              <template slot-scope="scope">
                <div @click="handleShowData(scope.row)" style="text-align: center;">
                  <a-tag v-if="scope.row.dataCnt" style="min-width: 55px; text-align: center; color: #c41d7f; cursor: pointer;">{{ scope.row.dataCnt || '-' }}</a-tag>
                  <span v-else>-</span>
                </div>
              </template>
            </u-table-column>

            <u-table-column prop="lastInsert" label="新入" width="80" sortable>
              <template slot-scope="scope">
                <div @click="handleLogs(scope.row)">
                  <a-tooltip placement="topLeft" :title="scope.row.lastInsert" :mouseEnterDelay="0.5">
                    <span style="text-decoration: none; cursor: pointer; padding-left: 2px;">
                      <a style="color: #ff4d4f; font-size: 12px;" v-if="scope.row.notifyFlag === 1">
                        <a-icon type="warning" />
                      </a>
                    </span>
                    <span>
                      {{ scope.row.lastInsert | timeago }}
                    </span>
                  </a-tooltip>
                </div>
              </template>
            </u-table-column>
            <u-table-column prop="lastSuccess" label="成功" width="80" sortable>
              <template slot-scope="scope">
                <div>
                  <a-tooltip placement="topLeft" :title="scope.row.lastSuccess" :mouseEnterDelay="0.5">
                    {{ scope.row.lastSuccess | timeago }}
                  </a-tooltip>
                </div>
              </template>
            </u-table-column>
            <u-table-column prop="remark" label="备注" width="115" sortable>
              <template slot-scope="scope">
                <div>
                  <div @click="handleRemark(scope.row)" style="text-align: center; width: 90%; height: 90%;">
                    <a-badge v-if="scope.row.tags" :offset="[-3, 0]">
                      <a-icon style="font-size: 10px; color: #2db7f5;" slot="count" type="tag"/>
                    </a-badge>
                    <a-tooltip placement="topLeft" :title="scope.row.remark +',' + scope.row.tags" :mouseEnterDelay="0.5">
                      {{ scope.row.remark || '-' }}
                    </a-tooltip>
                  </div>
                </div>
              </template>
            </u-table-column>
            <u-table-column prop="jobCnt" label="关联" width="100">
              <template slot-scope="scope">
                <span style="cursor: pointer;" title="点击配置步骤" @click="showSteps(scope.row)">
                  <a-popover v-if="scope.row.stepCnt && scope.row.stepCnt > 0">
                    <template slot="content">
                      步骤
                    </template>
                    <a-icon style="font-size: 16px; color: #1890ff;" type="branches" />
                  </a-popover>
                  <a-popover v-else>
                    <template slot="content">
                      步骤
                    </template>
                    <a-icon style="font-size: 14px;" type="branches"/>
                  </a-popover>
                </span>
                <a-divider type="vertical"/>
                <span style="cursor: pointer;" @click="showCron(scope.row)">
                  <a-popover v-if="scope.row.jobCnt && scope.row.jobCnt > 0">
                    <template slot="content">
                      定时运行中
                    </template>
                    <a-icon style="font-size: 14px; color:green;" type="clock-circle" />
                  </a-popover>
                  <a-popover v-else-if="scope.row.allJobCnt > 0 && scope.row.jobCnt === 0">
                    <template slot="content">
                      定时暂停中
                    </template>
                    <a-icon style="font-size: 14px; color:red;" type="pause-circle"/>
                  </a-popover>
                  <a-popover v-else>
                    <template slot="content">
                      定时未配
                    </template>
                    <a-icon style="font-size: 14px;" type="stop"></a-icon>
                  </a-popover>
                </span>
                <a-divider type="vertical"/>
                <span style="cursor: pointer;" @click="showMonitorModal(scope.row)">
                  <a-popover v-if="scope.row.alarmCnt && scope.row.alarmCnt > 0">
                    <template slot="content">
                      监控中.
                    </template>
                    <a-icon v-if="scope.row.lastCheckState === 'E'" style="font-size: 14px; color: red;" type="bell"/>
                    <a-icon v-else type="bell" theme="twoTone" style="font-size: 14px;"/>
                  </a-popover>
                  <a-popover v-else>
                    <template slot="content">
                      未配监控
                    </template>
                    <a-icon style="font-size: 14px;" type="plus" />
                  </a-popover>
                </span>
              </template>
            </u-table-column>

            <u-table-column prop="author" label="责任人" width="80" sortable>
              <template slot-scope="scope">
                <div @click="handleRemark(scope.row)" style="text-align: center; width: 90%; height: 90%;">
                  <a-tooltip placement="topLeft" :title="scope.row.author" :mouseEnterDelay="0.5">
                    {{ scope.row.author || '-' }}
                  </a-tooltip>
                </div>
              </template>
            </u-table-column>

            <u-table-column prop="entryTypeId" label="主表" width="80" sortable>
              <template slot-scope="scope">
                <div @click="handleShowEntryType(scope.row.entryTypeId)" style="text-decoration: underline; cursor: pointer;">
                  {{ scope.row.entryTypeId }}
                </div>
              </template>
            </u-table-column>
            <!--            <u-table-column prop="domain" label="域" width="80" sortable>-->
            <!--              <template slot-scope="scope">-->
            <!--                <span style="min-width: 55px; text-align: center;">{{ scope.row.domain }}</span>-->
            <!--              </template>-->
            <!--            </u-table-column>-->
            <u-table-column prop="lastRun" label="任务" width="75" sortable>
              <template slot-scope="scope">
                <div>
                  <a-tooltip placement="topLeft" :title="scope.row.lastRun" :mouseEnterDelay="0.5">
                    {{ scope.row.lastRun | timeago }}
                  </a-tooltip>
                </div>
              </template>
            </u-table-column>
            <u-table-column prop="nextRun" label="下次" width="75" sortable>
              <template slot-scope="scope">
                <div>
                  <a-tooltip placement="topLeft" :title="scope.row.nextRun" :mouseEnterDelay="0.5">
                    {{ scope.row.nextRun | timeago }}
                  </a-tooltip>
                </div>
              </template>
            </u-table-column>
            <u-table-column prop="action" label="操作" width="120" fixed="right">
              <template slot-scope="scope">
                <a-dropdown>
                  <a class="ant-dropdown-link">
                    查询<a-icon type="down"/>
                  </a>
                  <a-menu slot="overlay">
                    <a-menu-item @click="showMonitorModal(scope.row)">
                      <a-icon type="trademark" />监控
                    </a-menu-item>
                    <a-menu-item @click="openDataMonitor(scope.row)">
                      <a-icon type="dashboard" />数据监控
                    </a-menu-item>
                    <a-menu-item @click="showLogModal(scope.row)">
                      <a-icon type="trademark" />日志
                    </a-menu-item>
                    <a-menu-item @click="handleShowTask(scope.row)">
                      <a-icon type="carry-out"/>任务
                    </a-menu-item>
                    <a-menu-item @click="handleDetail(scope.row)">
                      <a-icon type="more" />详情
                    </a-menu-item>
                    <a-menu-item @click="handleShowFile(scope.row)">
                      <a-icon type="folder"/>原始文件
                    </a-menu-item>
                    <a-menu-item @click="handleShowJson(scope.row)">
                      <a-icon type="code"/>保存时Json
                    </a-menu-item>
                    <!--                    <a-menu-item @click="showCron(scope.row)">-->
                    <!--                      定时配置-->
                    <!--                    </a-menu-item>-->
                    <!--                    <a-menu-item @click="showSteps(scope.row)">-->
                    <!--                      步骤配置-->
                    <!--                    </a-menu-item>-->
                    <!--                    <a-menu-item @click="handleShowData(scope.row)">-->
                    <!--                      查看数据-->
                    <!--                    </a-menu-item>-->
                  </a-menu>
                </a-dropdown>
                <a-divider type="vertical"/>
                <a-dropdown>
                  <a class="ant-dropdown-link">
                    变更<a-icon type="down"/>
                  </a>
                  <a-menu slot="overlay">
                    <a-menu-item @click="handleEdit(scope.row)">
                      <a-icon type="edit"/>编辑
                    </a-menu-item>
                    <a-menu-item @click="handleCopySource(scope.row, 1)">
                      <a-icon type="copy"/>制作源+配置副本
                    </a-menu-item>
                    <a-menu-item @click="handleCopySource(scope.row, 0)">
                      <a-icon type="copy"/>仅制作源副本
                    </a-menu-item>
                    <a-menu-item @click="genConfig(scope.row)">
                      <a-icon type="diff"/>生成新配置并应用到当前源
                    </a-menu-item>
                    <a-menu-item key="85" @click="handleBindSiteOpen([scope.row.sourceId])">
                      <a-icon type="global"/>关联网站
                    </a-menu-item>
                    <!--                    <a-menu-item @click="handleState(scope.row, 'C')">-->
                    <!--                      <a-icon type="check" />标识正常状态-->
                    <!--                    </a-menu-item>-->
                  </a-menu>
                </a-dropdown>
              </template>
            </u-table-column>
          </u-table>
          <base-edit-modal ref="modal" :cols="editCols" :callback="updateCallback" title="源编辑"/>
          <source-param ref="paramModal" :callback="sendWithParamsCallback"></source-param>
          <a-modal
            title="发测试队列"
            :visible="testQueueVisible"
            @ok="handleTestQueueOk"
            @cancel="handleTestQueueCancel"
          >
            <a-form-model :label-col="{ span: 4 }" :wrapper-col="{ span: 18 }">
              <a-form-model-item label="测试队列" required>
                <a-input v-model="testQueue" placeholder="请输入测试队列名称" allowClear @pressEnter="handleTestQueueOk"/>
                <div style="color: #999; font-size: 12px; line-height: 20px;">发送到指定测试队列, 不影响正常抓取队列</div>
              </a-form-model-item>
            </a-form-model>
          </a-modal>
          <source-cron ref="cronModal" :callback="saveSourceCronCallback"></source-cron>
          <d-cron-modal ref="cronList"></d-cron-modal>
          <d-monitor-modal ref="monitorModal"></d-monitor-modal>
          <d-step-modal ref="stepList"></d-step-modal>
          <entry-list-show ref="entryList"></entry-list-show>
          <file-list-show ref="fileList"></file-list-show>
          <json-list-show ref="jsonList"></json-list-show>
          <task-list-show ref="taskList"></task-list-show>
          <config-detail ref="configDetail"></config-detail>
          <source-detail ref="sourceDetail"/>
          <config-edit ref="configEdit"></config-edit>
          <entry-type-detail ref="entryTypeDetail"></entry-type-detail>
          <job-log-modal ref="jobLogModal" @refresh="handleRefresh"></job-log-modal>
          <a-modal :width="900" :visible="visibleAddBatch" @ok="batchAddReturn" @cancel="closeBatchAdd">
            <a-row :gutter="[8, 8]">
              <a-col :span="6">
                模板源:
              </a-col>
              <a-col :span="18">
                <a-input v-if="curSource" :value="curSource.sourceId + '-' + curSource.sourceName"></a-input>
              </a-col>
            </a-row>
            <a-row :gutter="[8, 8]">
              <a-col :span="6">
                深度复制:
              </a-col>
              <a-col :span="4">
                <a-switch v-model="deepCopy" @change="handleDeepCopy()"/>
              </a-col>
              <a-col :span="12">
                <a-alert style="background-color: white;" message="说明: 如开启,则会自动为多行数据生成多个配置" banner />
              </a-col>
            </a-row>
            <a-row :gutter="[8, 8]">
              <a-col :span="6">
                目标目录:
              </a-col>
              <a-col :span="18">
                <d-category-input v-model="targetCategory" placeholder="目录, 如不选,则与模板源同目录"/>
              </a-col>
            </a-row>
            <a-textarea
              placeholder="名称与URL分割符 ;  例:   名称;url"
              v-model="batchTxt"
              rows="20"
              :cols="100"
              :allowClear="true" />
          </a-modal>
          <a-modal
            :width="900"
            :visible="visibleCopySnatch"
            title="批量更新主配置"
            @ok="handleCopySnatch()"
            @cancel="handleCopySnatchOpen(false)"
          >
            源ID:<a-input v-model="srcSourceId" placeholder="根据源复制将复制主配+登陆配置"></a-input>
            对应配置：<a-input v-model="srcConfigId"></a-input>
          </a-modal>
          <a-modal
            :width="900"
            :visible="visibleAuthSet"
            title="批量设登陆要求"
            @ok="handleAuthSet()"
            @cancel="handleAuthSetOpen(false)"
          >
            登陆配置ID:<a-input v-model="authConfigId" placeholder="请输入登陆配置ID"></a-input>
          </a-modal>
          <a-modal :width="900" :visible="visibleInfo" @cancel="visibleInfo = false">
            <a-row :gutter="[8, 8]">
              <a-col :span="4">
                选择列:
              </a-col>
              <a-col :span="12">
                <a-checkbox-group v-model="infoColumns" :options="infoColumnsOptions" @change="fetchBaseInfo" />
              </a-col>
              <a-col :span="8">
                共 <span style="color:red;">{{ infoLength }}</span> 行:
              </a-col>
            </a-row>
            <a-row style="padding-top: 20px;">
              <a-textarea
                v-model="infoTxt"
                rows="20"
                :cols="100"
                :allowClear="true" />
            </a-row>
          </a-modal>
          <a-modal :width="900" :visible="visibleIds" @ok="batchMarkReturn()" @cancel="visibleIds = false">
            <a-row :gutter="[8, 8]">
              <a-col :span="4">
                标记:
              </a-col>
              <a-col :span="16">
                <a-select style="width:100%;" v-model="defaultFlag" placeholder="标记" default-value="" @change="handleRefresh(true)">
                  <a-select-option v-for="c in colors" :key="c.key" :value="c.key">
                    <a-badge :color="c.code" :text="c.text" />
                  </a-select-option>
                </a-select>
              </a-col>
            </a-row>
            <a-textarea
              placeholder="批量源IDS,用逗号(,)分割"
              v-model="batchIds"
              rows="20"
              :cols="100"
              :allowClear="true" />
          </a-modal>
          <a-modal :width="900" :visible="visibleCategory" @ok="batchChangeCategory()" @cancel="visibleCategory = false">
            <a-row :gutter="[8, 8]">
              <a-col :span="4">
                新分类目录:
              </a-col>
              <a-col :span="16">
                <d-category-input v-model="changeToCategory" placeholder="目录"/>
              </a-col>
            </a-row>
          </a-modal>
          <a-modal :width="520" :visible="visibleBindSite" title="关联网站" @ok="handleBindSite" @cancel="visibleBindSite = false">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 16 }">
              <a-form-item label="目标网站">
                <a-select v-model="bindSiteId" placeholder="请选择归属网站" show-search option-filter-prop="children" style="width: 100%">
                  <a-select-option v-for="s in siteOptions" :key="s.siteId" :value="s.siteId">
                    {{ s.siteName }}<span v-if="s.stdSiteName && s.stdSiteName !== s.siteName" style="color: #999">（{{ s.stdSiteName }}）</span>
                  </a-select-option>
                </a-select>
              </a-form-item>
              <a-form-item label="影响范围">
                {{ bindIds.length }} 个源
              </a-form-item>
            </a-form>
          </a-modal>
          <source-log-modal ref="logModal"></source-log-modal>
          <prompt ref="prompt"></prompt>
        </div>
      </a-col>
    </a-row>
  </a-card>
</template>

<script>
import CategoryTree from './modules/CategoryTree'
import { STable, Ellipsis } from '@/components'
import AStatistic from 'ant-design-vue/es/statistic'
import { getSourcePaged, updateSource, updateSourceSimple, loadParams, sendWithParams, addSourceBatch, clearCache, genConfig, changeSourceEnable, deleteSource, copySnatchConfig, sendAllCategory, copySource, markSourceFlag, updateStateBatch, changeKeepLast, querySourceDetail, markBatch, changeCategory, clearAuth, authSet, searchTopic, queryStepDetail, changeSite, bindSite } from '@/api/source'
import { sendConfigTask } from '@/api/config'
import { getSiteList } from '@/api/site'
import { saveSourceCron } from '@/api/source-job'
import { runMeasure } from '@/api/dataset'
import BaseEditModal from './modules/BaseEdit'
import BaseDetailDrawer from './modules/BaseDetail'
import SourceParam from './modules/SourceParam'
import SourceCron from './modules/SourceCron'
import DCronModal from './modules/CronModal'
import DMonitorModal from './modules/MonitorModal'
import DStepModal from './modules/StepModal'
import DetailList from '@/components/tools/DetailList'
import moment from 'moment'
import DConfigSelect from '../base/ConfigSelect'
import DEntryTypeSelect from '../base/EntryTypeSelect'
import DCategoryInput from '../base/CategoryInput'
import EntryListShow from '../base/detail/EntryListShow'
import FileListShow from '../base/detail/FileListShow'
import JsonListShow from '../base/detail/JsonListShow'
import TaskListShow from '../base/detail/TaskListShow'
import { allColumns, allColors } from '@/config/column.config'
import ConfigDetail from '../base/detail/ConfigDetail'
import SourceDetail from '../base/detail/SourceDetail'
import ConfigEdit from '../base/edit/ConfigEdit'
import EntryTypeDetail from './modules/EntryTypeDetail'
import SourceLogModal from './modules/SourceLogModal'
import Prompt from '../base/comm/Prompt'
import JobLogModal from '@/page/config/modules/JobLogModal'
import SourceSearch from '@/page/config/lite/SourceSearch.vue'
import SourceSearchNotify from '@/page/config/lite/SourceSearchNotify.vue'
import { pagedSourceCheck } from '@/api/monitor'

const DetailListItem = DetailList.Item

export default {
  name: 'SourceList',
  components: {
    SourceSearchNotify,
    SourceSearch,
    JobLogModal,
    Prompt,
    DMonitorModal,
    EntryTypeDetail,
    ConfigDetail,
    BaseEditModal,
    BaseDetailDrawer,
    STable,
    Ellipsis,
    CategoryTree,
    DetailList,
    DetailListItem,
    SourceParam,
    SourceCron,
    DCronModal,
    DStepModal,
    DConfigSelect,
    DEntryTypeSelect,
    DCategoryInput,
    AStatistic,
    EntryListShow,
    FileListShow,
    JsonListShow,
    TaskListShow,
    ConfigEdit,
    SourceDetail,
    SourceLogModal
  },
  props: {
  },
  data () {
    return {
      testQueueVisible: false,
      testQueue: '',
      childLoadingMap: {},
      expandedRows: [], // 记录当前展开的行
      childDataMap: {}, // 缓存子数据（key: sourceId, value: 子数据数组）
      topicSelect: [
        {
          value: '',
          text: '--空--'
        }
      ],
      visibleCategory: false,
      changeToCategory: undefined,
      infoLength: 0,
      infoColumnsOptions: ['源名称', '源URL', '源ID', '源ID(逗号合并)'],
      infoColumns: ['源名称', '源URL'],
      visibleInfo: false,
      infoTxt: undefined,
      defaultFlag: 1,
      batchIds: undefined,
      visibleIds: false,
      showCategory: true,
      height: 900,
      rowHeight: 40,
      rowHeight2: 30,
      openKeys: [],
      mdl: {},
      // 高级搜索 展开/关闭
      advanced: false,
      colors: allColors.markColors,
      freqColors: allColors.freqColors,
      // 查询参数
      queryParam: {
        freq: undefined,
        idsStr: undefined,
        ids: undefined,
        sourceId: undefined,
        name: undefined,
        sourceUrl: undefined,
        entryTypeId: undefined,
        configId: undefined,
        count: undefined,
        dataDate: undefined,
        enable: '0',
        state: undefined,
        categorys: undefined,
        cron: undefined,
        topic: undefined,
        notify: '',
        groupBy: undefined,
        sorted: -1,
        tags: []
      },
      pageForm: {
        total: 1000,
        pageSize: 20,
        pageNo: 1
      },
      freqSum: {},
      searchText: '',
      searchInput: null,
      selectedRowKeys: [], // Check here to configure the default column
      selectedRows: [],
      dateArray: [],
      oriData: [],
      // 关联网站
      bindIds: [],
      visibleBindSite: false,
      bindSiteId: undefined,
      siteOptions: [],
      curSource: undefined,
      batchTxt: '',
      deepCopy: false,
      targetCategory: undefined,
      visibleAddBatch: false,
      columns: allColumns.SOURCE.BASE,
      otherCols: allColumns.SOURCE.OTHER,
      visibleAuthSet: false,
      authConfigId: undefined,
      // 批量复制配置
      visibleCopySnatch: false,
      srcSourceId: undefined,
      srcConfigId: undefined,
      // 加载数据方法 必须为 Promise 对象
      loadData: parameter => {
        if (this.queryParam.state === '') {
          this.queryParam.state = undefined
        }
        if (this.queryParam.idsStr) {
          const strs = this.queryParam.idsStr.split('\n')
          this.queryParam.ids = strs.join(',')
        } else {
          this.queryParam.ids = undefined
          this.queryParam.idsStr = undefined
        }
        return getSourcePaged(Object.assign(parameter, this.queryParam))
          .then(res => {
            this.oriData = res.data
            const ext = res.exts // [{ "freq": "WEEK", "notifyCount": 0, "allCount": 12 }]
            ext.forEach(item => {
              if (!item.freq) {
                item.freq = 'NONE'
              }
              this.$set(this.freqSum, item.freq, item)
            })
            console.log(this.freqSum)
            this.pageForm.total = res.count
            return res.data
          })
      },
      options: {
        alert: {
          show: true,
          clear: () => {
            this.selectedRowKeys = []
            this.clearSection()
          }
        },
        rowSelection: {
          selectedRowKeys: this.selectedRowKeys,
          onChange: this.onSelectChange
        }
      },
      optionAlertShow: true,
      treeData: [
      ]
    }
  },
  created () {
    if (this.$route.query.sourceId) {
      this.queryParam.sourceId = this.$route.query.sourceId
    }
    const height = document.body.clientHeight - 120
    if (height > 900) {
      this.height = height
    }
    this.tableOption()
  },
  filters: {
    changeTime: function (dateStr) {
      return '11'
    },
    freqFilter: function (dateStr) {
      if (dateStr === 'WEEK') {
        return '周'
      } else if (dateStr === 'MONTH') {
        return '月'
      } else if (dateStr === 'DAY') {
        return '日'
      } else if (dateStr === 'TEN') {
        return '旬'
      } else if (dateStr === 'SEASON') {
        return '季'
      } else if (dateStr === 'ONCE') {
        return '辅'
      } else {
        return ''
      }
    }
  },
  computed: {
    editCols: function () {
      let temp = [...this.columns, ...this.otherCols]
      temp = temp.filter(col => !col.noEdit)
      console.log('edit col', temp)
      return temp
    },
    detailCols: function () {
      let temp = [...this.columns, ...this.otherCols]
      temp = temp.filter(col => !col.noDetail)
      console.log(temp)
      return temp
    },
    hasSelected () {
      return this.selectedRowKeys.length > 0
    }
  },
  watch: {
  },
  methods: {
    getRowClass ({ row }) {
      if (!row.stepCnt || row.stepCnt <= 0) {
        return 'row-no-expand' // 没步骤的行，标记为 row-no-expand
      }
      return ''
    },
    async loadChildData (row) {
      const res = await queryStepDetail({ sourceId: row.sourceId }, true)
      console.log('loadStepData', res)
      const data = res.data.filter(
        item => item.stepId !== 0
      )
      // 排除authConfig为null的
      return data
    },
    async handleExpandChange (row, expandedRows) {
      // 兼容性处理：有些版本第一个参数就是 row，有些是对象封装
      const targetRow = row.row || row
      const rowKey = targetRow.sourceId
      console.log('原始 row 参数:', row)
      console.log('当前所有已展开行:', expandedRows)

      // 打印日志排查：如果控制台没出这个 ID，说明事件没触发或参数不对
      console.log('正在展开行 ID:', rowKey)
      if (!rowKey) return

      // 如果是折叠操作，直接返回
      const isExpanded = expandedRows.some(r => (r.row ? r.row.sourceId : r.sourceId) === rowKey)
      if (!isExpanded) return
      // 1. 开启加载动画
      this.$set(this.childLoadingMap, rowKey, true)
      try {
        const childData = await this.loadChildData(targetRow)
        this.$set(this.childDataMap, rowKey, childData)
      } catch (e) {
        console.error('加载子表失败', e)
      } finally {
        // 2. 关闭加载动画
        this.$set(this.childLoadingMap, rowKey, false)

        this.$nextTick(() => {
          if (this.$refs.sourceTable) {
            this.$refs.sourceTable.doLayout()
          }
        })
      }
    },
    handleLogs (record) {
      if (record.alarmCnt > 0) {
        this.$refs.jobLogModal.showModal(record.sourceId)
      }
    },

    handleTopicSearch (value) {
      searchTopic(value).then(res => {
        res.data.forEach(
          item => this.topicSelect(
            {
              value: item,
              text: item
            }
          ))
      }).catch(() => {
        this.$notification['error']({
          message: '查询出问题'
        })
      }).finally(() => {
      })
      // const val = this.topicSelect.filter(s => s.value === value)
      // if (!val || val.length === 0) {
      //   this.topicSelect.push({
      //     value: value,
      //     text: value
      //   })
      // }
    },
    handleTopicBlur () {
      console.log('blur')
    },
    handleTopicChange (value) {
      console.log(`selected ${value}`)
      this.queryParam.topic = value
    },
    clearParam () {
      this.queryParam.idsStr = null
      this.queryParam.sourceId = null
      this.queryParam.sourceId = null
      this.queryParam.name = null
      this.queryParam.sourceUrl = null
      this.queryParam.entryTypeId = null
      this.queryParam.configId = null
      this.queryParam.count = null
      this.queryParam.dataDate = null
      this.queryParam.state = null
      this.queryParam.categorys = null
    },
    treeClick (param) {
      this.clearParam()
      this.queryParam = Object.assign(this.queryParam, param)
      this.handleRefresh(true)
    },
    treeCheck (param) {
      this.clearParam()
      this.queryParam = Object.assign(this.queryParam, param)
      this.handleRefresh(true)
    },
    handleRefresh (first) {
      if (first) {
        this.pageForm.pageNo = 1
      }
      if (this.dateArray && this.dateArray.length === 2) {
        this.queryParam.dataDate = moment(this.dateArray[0]).format('YYYYMMDDHHmm') +
          '-' + moment(this.dateArray[1]).format('YYYYMMDDHHmm')
      }
      Object.assign(this.queryParam, this.pageForm)
      this.loadData(this.queryParam)
      // console.log('this.selectedRowKeys2', this.selectedRowKeys)
      // console.log('this.selectedRowKeys21', this.selectedRows)
      // const keys = this.selectedRows
      // if (keys && keys.length > 0) {
      //   this.$nextTick(function () {
      //     this.$refs.sourceTable.toggleRowSelection(keys)
      //   })
      // }
    },
    tableOption () {
      if (!this.optionAlertShow) {
        this.options = {
          alert: {
            show: true,
            clear: () => {
              this.selectedRowKeys = []
            }
          },
          rowSelection: {
            selectedRowKeys: this.selectedRowKeys,
            onChange: this.onSelectChange
          }
        }
        this.optionAlertShow = true
      } else {
        this.options = {
          alert: false,
          rowSelection: null
        }
        this.optionAlertShow = false
      }
    },

    onSelectChange (selectedRowKeys, selectedRows) {
      this.selectedRowKeys = selectedRowKeys
      this.selectedRows = selectedRows
    },
    handleSearch (selectedKeys, confirm) {
      confirm()
      this.searchText = selectedKeys[0]
    },
    handleReset (clearFilters) {
      clearFilters()
      this.searchText = ''
    },

    /** 单行操作 **/
    handleEdit (record) {
      console.log('edit', record)
      this.$refs.modal.doEdit(record)
    },
    updateCallback (obj) {
      console.log('updateCallback', obj)
      delete obj.createDt
      delete obj.updateDt
      delete obj.lastInsert
      delete obj.lastRun
      delete obj.lastSuccess
      delete obj.modifyDt
      delete obj.lastCheck
      obj.updateAll = 1
      // todo 这边更新列表中的情况
      const sourceId = obj.sourceId
      const ret = updateSource(obj)
      this.oriData.forEach(entry => {
        if (entry.sourceId === sourceId) {
          Object.assign(entry, obj)
        }
      })
      return ret
    },

    // 更新源，不清理lastUrl
    updateSimple (obj) {
      console.log('updateSourceSimple', obj)
      delete obj.createDt
      delete obj.updateDt
      delete obj.lastInsert
      delete obj.lastRun
      delete obj.lastCheck
      return updateSourceSimple(obj)
    },

    saveSourceCronCallback (obj) {
      console.log('saveSourceCron', obj)
      return saveSourceCron(obj)
    },

    handleDetail (record) {
      console.log('detail', record)
      this.$refs.sourceDetail.showModal(record.sourceId)
    },

    showCron (record) {
      if (record) {
        this.$refs.cronList.showModal(record)
      } else {
        this.$refs.cronList.showModal(record, this.selectedRowKeys)
      }
    },
    batchMark (key, notifyFlag) {
      console.log('设置监控标识:', key, notifyFlag)
      const ids = this.selectedRowKeys
      if (ids.length === 0) {
        this.$message.error('请选择要操作的源ID')
        return false
      }
      markBatch(ids, null, key, notifyFlag).then(res => {
        this.$notification['success']({
          message: '批量设置成功, 返回值:-' + res.msg
        })
        this.visibleIds = false
      }).catch(() => {
        this.$notification['error']({
          message: '批量设置失败'
        })
      }).finally(() => {
      })
    },
    showSteps (record) {
      if (record) {
        this.selectCurrentRow(record, true)
        this.$refs.stepList.showModal(record)
      } else {
        const maped = this.selectedRows.map(item => item.configId)
        this.$refs.stepList.showModal(null, maped)
      }
    },
    /** 批量操作 **/
    // 1. 发任务
    sendBatch () {
      if (this.selectedRowKeys.length === 0) {
        this.$notification['error']({
          message: '请勾选需要发任务的记录'
        })
        return false
      }
      // 批量发送任务
      loadParams(this.selectedRowKeys).then(res => {
        if (res && res.data) {
          const configParam = res.data
          const hasLogin = false
          this.$refs.paramModal.showParam(configParam, this.selectedRows, hasLogin)
        } else {
          if (this.selectedRowKeys.length <= 2) {
            this.sendWithParamsCallback(this.selectedRowKeys, {}).then(res => {
              this.$notification['success']({
                duration: 2,
                message: '[源]发送成功, 本次发送' + this.selectedRowKeys.length + ', 返回值:-' + res.msg
              })
            }).catch(() => {
              this.$notification['error']({
                message: '发送失败'
              })
            }).finally(() => {
            })
          } else {
            this.$confirm({
              title: '提示',
              content: '是否确定要发送抓取任务，本次[ ' + this.selectedRowKeys.length + ' ]条?',
              onOk: () => {
                this.sendWithParamsCallback(this.selectedRowKeys, {}).then(res => {
                  this.$notification['success']({
                    message: '[源]发送成功, 本次发送' + this.selectedRowKeys.length + ', 返回值:-' + res.msg
                  })
                }).catch(() => {
                  this.$notification['error']({
                    message: '发送失败'
                  })
                }).finally(() => {
                })
              },
              onCancel () {
              }
            })
          }
        }
      })
    },

    sendWithParamsCallback (ids, object, all, include, skip, queue) {
      console.log('sendWithParamsCallback', ids, object, all, include, skip, queue)
      return sendWithParams(ids, object, all, include, skip, queue)
    },

    // 1.1 发抓取测试: 在发抓取流程基础上额外指定队列
    sendBatchTest () {
      if (this.selectedRowKeys.length === 0) {
        this.$notification['error']({
          message: '请勾选需要发任务的记录'
        })
        return false
      }
      this.testQueue = 'news_snt2'
      this.testQueueVisible = true
    },

    handleTestQueueOk () {
      const queue = (this.testQueue || '').trim()
      if (!queue) {
        this.$message.error('请输入测试队列')
        return
      }
      this.testQueueVisible = false
      this.sendTestBatch(queue)
    },

    handleTestQueueCancel () {
      this.testQueueVisible = false
    },

    sendTestBatch (queue) {
      loadParams(this.selectedRowKeys).then(res => {
        if (res && res.data) {
          const configParam = res.data
          this.$refs.paramModal.showParam(configParam, this.selectedRows, false, queue)
        } else {
          const doSendTest = () => {
            this.sendWithParamsCallback(this.selectedRowKeys, {}, undefined, undefined, undefined, queue).then(res => {
              this.$notification['success']({
                duration: 2,
                message: '[源]测试发送成功, 本次发送' + this.selectedRowKeys.length + ', 队列:-' + queue + ', 返回值:-' + res.msg
              })
            }).catch(() => {
              this.$notification['error']({
                message: '发送失败'
              })
            }).finally(() => {
            })
          }
          doSendTest()
        }
      })
    },

    // 2. 配定时
    configCron () {
      this.$refs.cronModal.show(this.selectedRowKeys.join(','))
    },

    deleteBatch () {
      if (this.selectedRowKeys.length === 0) {
        this.$notification['error']({
          message: '请选择要删除的源'
        })
        return false
      }
      this.$confirm({
        title: '提示',
        content: '是否确定要删除源，数量:' + this.selectedRowKeys.length + '?, ids= ' + this.selectedRowKeys.join(','),
        onOk: () => {
          deleteSource(this.selectedRowKeys).then(res => {
            this.$message.success('删除成功,共处理条：' + this.selectedRowKeys.length + (res.msg ? ', 返回:' + res.msg : ''))
            this.handleRefresh()
          }).catch((err) => {
            this.$notification['error']({
              message: '删除失败' + err
            })
            this.handleRefresh()
          }).finally(() => {
          })
        },
        onCancel () {
        }
      })
    },

    // 批量增加URL
    batchAdd () {
      const keys = this.selectedRows
      if (keys.length !== 1) {
        this.$message.error('请仅选择一个模板')
        return
      }
      this.curSource = this.selectedRows[0]
      this.batchTxt = null
      this.targetCategory = null
      // this.targetCategory = this.queryParam.categorys ? this.queryParam.categorys : null
      console.log('batch add url, templete: {}', this.curSource.sourceId)
      this.visibleAddBatch = true
    },
    batchAdd2 () {
      const rsp = querySourceDetail(301234892)
      rsp.then(res => {
        this.curSource = res.data
        this.batchTxt = null
        this.targetCategory = 9008731
        // this.targetCategory = this.queryParam.categorys ? this.queryParam.categorys : null
        console.log('batch add url, templete: {}', this.curSource.sourceId)
        this.visibleAddBatch = true
      }).catch((err) => {
        this.$notification['error']({
          message: '处理失败' + err
        })
      }).finally(() => {
      })
    },
    batchAddReturn () {
      if (!this.batchTxt) {
        this.$message.error('请输入要导入的文本')
        return false
      }
      this.visibleAddBatch = false
      const strs = this.batchTxt.split('\n')
      const name = this.curSource.sourceName
      this.$confirm({
        title: '提示',
        content: '是否确认要批量增加源，数量:' + strs.length + '?',
        onOk: () => {
          const items = []
          let i = 1
          for (let line of strs) {
            if (!line || line.trim() === '') {
              continue
            }
            // 如果未写名称
            if (line.indexOf(';') === -1) {
              line = name + '-' + i + ';' + line
              i++
            }
            items.push(line.trim())
            console.log('add source', line)
          }
          addSourceBatch(this.curSource.sourceId, items, this.deepCopy, this.targetCategory).then(res => {
            this.$message.success(res.msg)
          }).catch((err) => {
            this.$notification['error']({
              message: '处理失败' + err
            })
          }).finally(() => {
          })
        },
        onCancel () {
        }
      })
    },
    clearSection () {
      this.$refs.sourceTable.clearSelection()
    },
    closeBatchAdd () {
      this.visibleAddBatch = false
    },
    batchChangeEnable (enable) {
      changeSourceEnable(this.selectedRowKeys, enable).then(res => {
        this.$message.success('更新状态成功!')
        this.handleRefresh()
      }).catch((err) => {
        this.$notification['error']({
          message: '更新状态失败' + err
        })
      }).finally(() => {
      })
    },
    batchClear () {
      clearCache(this.selectedRowKeys).then(res => {
        this.$message.success('清除缓存成功!')
        this.handleRefresh()
      }).catch((err) => {
        this.$notification['error']({
          message: '清除缓存失败' + err
        })
      }).finally(() => {
      })
    },
    genConfig (row) {
      this.$confirm({
        title: '提示',
        content: '确认为该源新生成配置并应用:' + row.sourceName,
        onOk: () => {
          genConfig([row.sourceId]).then(res => {
            this.$message.success('生成配置成功!')
            this.handleRefresh()
          }).catch((err) => {
            this.$notification['error']({
              message: '生成配置失败' + err
            })
          }).finally(() => {
          })
        },
        onCancel () {
        }
      })
    },
    handleCopySource (row, flag) {
      const config = {
        width: 600,
        title: '请输入新的源名称及URL',
        cols: [
          {
            title: '新源名称',
            span: 4,
            width: 300,
            dataIndex: 'newName',
            defaultValue: row.sourceName + '_copy'
          },
          {
            title: '新源URL',
            span: 4,
            width: 300,
            dataIndex: 'newUrl',
            defaultValue: row.sourceUrl
          }
        ]
      }
      const self = this
      this.$refs.prompt.show(config, function (data) {
        console.log(data)
        const newName = data['newName']
        const newUrl = data['newUrl']
        copySource(row.sourceId, newName, newUrl, flag).then(res => {
          self.$notification.success({
            message: '复制成功',
            description: '生成源副本成功! 新名称：' + newName,
            duration: 2
          })
          self.handleRefresh()
        }).catch((err) => {
          self.$notification['error']({
            message: '生成新的源副本失败' + err
          })
        }).finally(() => {
        })
      })
    },
    batchChangeCategory () {
      changeCategory(this.selectedRowKeys, this.changeToCategory).then(res => {
        this.$message.success('批量更改目录成功!')
        this.visibleCategory = false
        this.handleRefresh()
      }).catch((err) => {
        this.$notification['error']({
          message: '批量更改失败' + err
        })
      }).finally(() => {
      })
    },
    // 关联网站：批量(ids 为空取选中) / 单行(ids=[sourceId])
    handleBindSiteOpen (ids) {
      if (!ids || !ids.length) {
        if (this.selectedRowKeys.length === 0) {
          this.$message.error('请选择要操作的源!')
          return false
        }
        this.bindIds = this.selectedRowKeys
      } else {
        this.bindIds = ids
      }
      this.bindSiteId = undefined
      getSiteList({}).then(res => {
        // siteList 响应为裸数组，拦截器直接返回数组本身（res.data 为 undefined）
        this.siteOptions = Array.isArray(res) ? res : (res.data || [])
      }).catch(err => {
        this.$notification['error']({ message: '加载网站列表失败: ' + err })
      })
      this.visibleBindSite = true
    },
    handleBindSite () {
      if (!this.bindSiteId) {
        this.$message.error('请选择目标网站!')
        return false
      }
      const ids = this.bindIds
      const api = ids.length === 1
        ? bindSite(ids[0], this.bindSiteId)
        : changeSite(ids, this.bindSiteId)
      api.then(res => {
        this.$message.success(ids.length === 1 ? '关联网站成功!' : '批量更改归属网站成功!')
        this.visibleBindSite = false
        this.handleRefresh()
      }).catch(err => {
        this.$notification['error']({ message: '关联网站失败: ' + err })
      })
    },
    handlePageSize ({ page, size }) {
      console.log(page, size)
      this.pageForm.pageNo = page
      this.pageForm.pageSize = size
      this.handleRefresh()
    },
    handleSelectionChange (val) {
      console.log(val)
      this.selectedRows = val
      this.selectedRowKeys = val.map((item) => {
        return item && item.sourceId
      })
    },
    /** tab 操作 **/
    // handleCloseCurrentTab () {
    //   this.$multiTab.closeCurrentPage() // or this.$multiTab.close()
    // },
    // showConfigSelect () {
    //   this.$refs.configModal.showSelect()
    // },
    // handleOpenData (tab) {
    //   console.log('open tab : ' + tab)
    //   this.$multiTab.open('/inst/entry-list?sourceId=' + tab.sourceId + '&entryType=' + tab.entryTypeId)
    // },
    handleOpenBuild () {
      this.$multiTab.open('/install/source-build')
    },
    selectCurrentRow (tab, single) {
      const row = {
        row: tab,
        selected: true
      }
      // 清空所有选择，然后再选中一个
      if (single) {
        this.$refs.sourceTable.clearSelection()
      }
      this.$refs.sourceTable.toggleRowSelection([row])
    },
    handleRemark (row) {
      console.log('remark', row)
      const config = {
        width: 600,
        title: '备注信息',
        cols: [
          {
            title: '责任人',
            span: 4,
            width: 450,
            dataIndex: 'author',
            type: 'text',
            defaultValue: row.author
          },
          {
            title: '标签',
            span: 4,
            width: 450,
            dataIndex: 'tags',
            type: 'text',
            defaultValue: row.tags
          },
          {
            title: '备注',
            span: 4,
            width: 450,
            dataIndex: 'remark',
            type: 'textArea',
            defaultValue: row.remark
          }
        ]
      }
      const self = this
      this.$refs.prompt.show(config, function (data) {
        console.log(data)
        const newName = data['remark']
        const author = data['author']
        const tags = data['tags']
        const obj = {
          sourceId: row.sourceId,
          remark: newName,
          author: author,
          tags: tags
        }
        updateSource(obj, newName).then(res => {
          self.$notification.success({
            message: '修改成功',
            description: '修改成功!',
            duration: 2
          })
          self.handleRefresh()
        }).catch((err) => {
          self.$notification['error']({
            message: '修改失败' + err
          })
        }).finally(() => {
        })
      })
    },
    // 批量备注: 选中多条源后, 统一设置相同备注, 复用 updateSource 逐条提交
    handleBatchRemark () {
      const ids = (this.selectedRowKeys || []).filter(id => id !== undefined && id !== null)
      if (ids.length === 0) {
        this.$message.info('请选择要备注的源')
        return
      }
      const config = {
        width: 600,
        title: '批量备注 (共 ' + ids.length + ' 条)',
        cols: [
          {
            title: '备注',
            span: 4,
            width: 450,
            dataIndex: 'remark',
            type: 'textArea',
            defaultValue: ''
          }
        ]
      }
      const self = this
      this.$refs.prompt.show(config, function (data) {
        const remark = (data['remark'] || '').trim()
        if (!remark) {
          self.$message.info('请输入备注内容')
          return true
        }
        const rowMap = {}
        self.selectedRows.concat(self.oriData).forEach(row => {
          if (row && row.sourceId) {
            rowMap[row.sourceId] = row
          }
        })
        let successCount = 0
        const failedIds = []
        const run = async () => {
          for (const id of ids) {
            const row = rowMap[id]
            const param = { sourceId: id, remark }
            if (row) {
              if (row.author !== undefined) param.author = row.author
              if (row.tags !== undefined) param.tags = row.tags
            }
            try {
              await updateSource(param)
              successCount++
            } catch (e) {
              failedIds.push(id)
            }
          }
          if (successCount > 0) {
            self.$notification.success({
              message: '批量备注完成',
              description: '成功 ' + successCount + ' 条' + (failedIds.length > 0 ? '，失败 ' + failedIds.length + ' 条' : ''),
              duration: 2
            })
            self.handleRefresh()
          } else {
            self.$notification.error({
              message: '批量备注失败',
              description: failedIds.length > 0 ? '共 ' + failedIds.length + ' 条失败' : ''
            })
          }
        }
        run()
      })
    },
    handleShowData (tab) {
      console.log('==> click row ==', tab)
      this.selectCurrentRow(tab, true)
      if (tab.entryTypeId === 1) {
        this.$notification['info']({
          message: '没有表ID,无法查看数据'
        })
        return
      }
      this.$refs.entryList.showModal(tab.sourceId, tab.entryTypeId)
    },
    handleShowData2 (sourceId, entryType) {
      console.log('==> click row ==', entryType)
      this.$refs.entryList.showModal(sourceId, entryType)
    },
    handleShowFile (tab) {
      this.$refs.fileList.showModal(tab.sourceId, null)
    },
    handleShowJson (tab) {
      this.$refs.jsonList.showModal(tab.sourceId)
    },
    showMonitorModal (row) {
      this.$refs.monitorModal.showModal(row)
    },
    async openDataMonitor (row) {
      const monitorWindow = window.open('about:blank', '_blank')
      let tableName = ''
      try {
        const res = await pagedSourceCheck({
          sourceId: row.sourceId,
          pageNo: 1,
          pageSize: 10
        })
        const data = res.data || []
        const monitor = Array.isArray(data) ? data[0] : (data.records && data.records[0])
        tableName = monitor && monitor.tableName ? monitor.tableName : ''
      } catch (err) {
        this.$message.warn('获取监控表名失败，将继续打开数据监控')
      }
      const params = [
        `sourceId=${encodeURIComponent(row.sourceId || '')}`,
        `sourceName=${encodeURIComponent(row.sourceName || '')}`,
        `tableName=${encodeURIComponent(tableName)}`
      ].join('&')
      const url = `${window.location.origin}/vrule/data-monitor?${params}`
      if (monitorWindow) {
        monitorWindow.location.href = url
      } else {
        window.open(url, '_blank')
      }
    },
    handleShowTask (tab) {
      const param = {
        sourceId: tab.sourceId,
        configId: tab.configId
      }
      this.$refs.taskList.showModal(param)
    },
    handleShowConfig (configId) {
      console.log(configId)
      this.$refs.configEdit.showModal(configId)
    },
    handleShowLastUrl (row) {
      querySourceDetail(row.sourceId).then(res => {
        const newData = res.data
        if (!newData.lastUrl) {
          this.$message.info('未保存最近url')
          return
        }
        window.open(newData.lastUrl, '_target')
      }).catch((err) => {
        this.$notification['error']({
          message: '获取信息源详情失败' + err
        })
      }).finally(() => {
      })
    },
    handleShowEntryType (entryTypeId) {
      this.$refs.entryTypeDetail.showModal(entryTypeId)
    },
    handleDeepCopy () {
    },
    sendCategory () {
      console.log('send category, ', this.queryParam.categorys)
      this.$confirm({
        title: '提示',
        content: '[实验性]，是否确定发送该目录所有数据[' + this.queryParam.categorys + ' ]?',
        onOk: () => {
          let count = this.queryParam.count
          if (!count) {
            count = 100000
          }
          let state = this.queryParam.state
          if (state === '') {
            state = undefined
          }
          const params = {
            'categoryIds': this.queryParam.categorys,
            'count': count,
            'state': state,
            'sourceUrl': this.queryParam.sourceUrl,
            'name': this.queryParam.name,
            'entryTypeId': this.queryParam.entryTypeId,
            'flag': this.queryParam.flag
          }
          sendAllCategory(params).then(res => {
            this.$notification['success']({
              message: '按目录发送成功' + this.selectedRowKeys.length + ', 返回值:-' + res.msg
            })
          }).catch(() => {
            this.$notification['error']({
              message: '发送失败'
            })
          }).finally(() => {
          })
        },
        onCancel () {
        }
      })
    },
    markSourcesDev () {
      console.log('markSourcesDev ')
      this.visibleIds = true
    },
    buildInfoTxt (source) {
      let txt = ''
      if (this.infoColumns.indexOf(this.infoColumnsOptions[3]) !== -1) {
        return source.sourceId + ','
      }
      if (this.infoColumns.indexOf(this.infoColumnsOptions[2]) !== -1) {
        txt += ';' + source.sourceId
      }
      if (this.infoColumns.indexOf(this.infoColumnsOptions[0]) !== -1) {
        txt += ';' + source.sourceName
      }
      if (this.infoColumns.indexOf(this.infoColumnsOptions[1]) !== -1) {
        txt += ';' + source.sourceUrl
      }
      if (txt.startsWith(';')) {
        txt = txt.substring(1)
      }
      return txt + '\n'
    },
    runMeasure () {
      console.log('runMeasure', this.infoColumns)
      if (this.selectedRows.length === 0) {
        this.$notification['error']({
          message: '请选择要执行指标转换的源'
        })
        return false
      }
      for (const row of this.selectedRows) {
        runMeasure(row.sourceId).then(res => {
          this.$message.info('已提交执行指标：' + row.sourceId)
        }).catch((err) => {
          this.$notification['error']({
            message: '失败原因:' + err
          })
        }).finally(() => {
        })
      }
    },

    fetchBaseInfo () {
      console.log('fetchBaseInfo', this.infoColumns)
      this.visibleInfo = true
      this.infoTxt = ''
      const data = this.selectedRows.length === 0 ? this.oriData : this.selectedRows
      this.infoLength = data.length
      data.forEach(entry => {
        this.infoTxt += this.buildInfoTxt(entry)
      })
      if (this.infoTxt.startsWith(';')) {
        this.infoTxt = this.infoTxt.substring(1)
      }
      this.infoTxt = this.infoTxt.trim()
      if (this.infoTxt.endsWith(',')) {
        this.infoTxt = this.infoTxt.substring(0, this.infoTxt.length - 1)
      }
    },
    batchMarkReturn () {
      console.log('batch mark return')
      this.batchIds = this.batchIds.trim()
      const ids = this.batchIds.split('\n')
      console.log('===>', ids.length)
      this.$confirm({
        title: '提示',
        content: '[实验性]，批量标识文本中[' + ids.length + ' ] 个源ID?',
        onOk: () => {
          markBatch(ids, this.defaultFlag).then(res => {
            this.$notification['success']({
              message: '批量标识成功, 返回值:-' + res.msg
            })
            this.visibleIds = false
          }).catch(() => {
            this.$notification['error']({
              message: '批量标识失败'
            })
          }).finally(() => {
          })
        },
        onCancel () {
        }
      })
    },
    // copySnatch
    handleCopySnatch () {
      copySnatchConfig(this.selectedRowKeys, this.srcSourceId, this.srcConfigId).then(res => {
        this.$message.success('复制成功,共处理条：' + this.selectedRowKeys.length + (res.msg ? ', 返回:' + res.msg : ''))
        this.handleCopySnatchOpen(false)
        this.handleRefresh()
      }).catch((err) => {
        this.$notification['error']({
          message: '复制失败' + err
        })
        this.handleRefresh()
      }).finally(() => {
      })
    },
    handleCopySnatchOpen (bool) {
      console.log('handleCopySnatchOpen', bool)
      this.visibleCopySnatch = bool
    },
    handleAuthSetOpen (bool) {
      console.log('handleCopySnatchOpen', bool)
      this.visibleAuthSet = bool
    },
    handleSortChange (column) {
      const fieldName = column.prop
      const sortingType = column.order
      console.log(fieldName, sortingType)
      if (fieldName === 'sourceId') {
        this.queryParam.field = 'SOURCE_ID'
      } else if (fieldName === 'sourceName') {
        this.queryParam.field = 'SOURCE_NAME'
      } else if (fieldName === 'lastSuccess') {
        this.queryParam.field = 'LAST_SUCCESS'
      } else if (fieldName === 'lastInsert') {
        this.queryParam.field = 'LAST_INSERT'
      } else if (fieldName === 'dataCnt') {
        this.queryParam.field = 'DATA_CNT'
      } else if (fieldName === 'lastRun') {
        this.queryParam.field = 'NEXT_RUN'
      } else if (fieldName === 'nextRun') {
        this.queryParam.field = 'NEXT_RUN'
      }
      if (sortingType === 'ascending') {
        this.queryParam.type = 'ASC'
      } else {
        this.queryParam.type = 'DESC'
      }
      this.handleRefresh()
    },
    handleMarkSource (flag) {
      const keys = this.selectedRowKeys
      if (keys.length === 0) {
        this.$message.error('请勾选数据行')
        return
      }
      markSourceFlag(this.selectedRowKeys, flag, null).then(res => {
        this.$notification['success']({
          message: '标记成功'
        })
        this.handleRefresh(false)
      }).catch(() => {
        this.$notification['error']({
          message: '标记失败'
        })
      }).finally(() => {
      })
    },
    handleMarkTags () {
      const config = {
        width: 600,
        title: '请输出标签名称以#开头,多个以逗号分隔',
        cols: [
          {
            title: '标签名称',
            span: 4,
            width: 300,
            dataIndex: 'tagName',
            defaultValue: ''
          }
        ]
      }
      const keys = this.selectedRowKeys
      if (keys.length === 0) {
        this.$message.error('请勾选数据行')
        return
      }
      this.$refs.prompt.show(config, function (data) {
        console.log(data)
        const tagName = data['tagName']
        if (!tagName || tagName.trim().length === 0 || !tagName.trim().startsWith('#')) {
          this.$notification['error']({
            message: '请输入标签名称以#开头'
          })
          return true
        }
        markBatch(keys, null, null, null, tagName).then(res => {
          this.$notification['success']({
            message: '批量设置成功, 返回值:-' + res.msg
          })
          this.visibleIds = false
        }).catch(() => {
          this.$notification['error']({
            message: '批量设置失败'
          })
        }).finally(() => {
        })
      })
    },
    handleClearMark () {
      const keys = this.selectedRowKeys
      if (keys.length === 0) {
        this.$message.error('请勾选数据行')
        return
      }
      markSourceFlag(this.selectedRowKeys, 1, 1).then(res => {
        this.$notification['success']({
          message: '清除标记成功'
        })
        this.handleRefresh(false)
      }).catch(() => {
        this.$notification['error']({
          message: '清除标记失败'
        })
      }).finally(() => {
      })
    },
    handleKeep (row, keep) {
      let ids = []
      if (row) {
        ids.push(row.sourceId)
      } else {
        ids = this.selectedRowKeys
      }
      changeKeepLast(ids, keep).then(res => {
        this.$notification['success']({
          message: '更改成功'
        })
        this.handleRefresh(false)
      }).catch(() => {
        this.$notification['error']({
          message: '更改失败'
        })
      }).finally(() => {
      })
    },
    handleAuthSet () {
      const keys = this.selectedRowKeys
      if (keys.length === 0) {
        this.$message.error('请勾选数据行')
        return
      }
      authSet(this.selectedRowKeys, this.authConfigId).then(res => {
        this.$notification['success']({
          message: '清除登陆要求成功'
        })
        this.handleAuthSetOpen(false)
        this.handleRefresh(false)
      }).catch(() => {
        this.$notification['error']({
          message: '清除登陆要求失败'
        })
      }).finally(() => {
      })
    },
    handleClearAuth () {
      const keys = this.selectedRowKeys
      if (keys.length === 0) {
        this.$message.error('请勾选数据行')
        return
      }
      this.$confirm({
        title: '提示',
        content: '是否确认清除选中源的登陆要求:本次' + keys.length + '条',
        onOk: () => {
          clearAuth(this.selectedRowKeys).then(res => {
            this.$notification['success']({
              message: '清除登陆要求成功'
            })
            this.handleRefresh(false)
          }).catch(() => {
            this.$notification['error']({
              message: '清除登陆要求失败'
            })
          }).finally(() => {
          })
        },
        onCancel () {
        }
      })
    },
    handleState (row, state) {
      let ids = []
      if (row) {
        ids.push(row.sourceId)
      } else {
        ids = this.selectedRowKeys
      }
      updateStateBatch(ids, state).then(res => {
        this.$notification['success']({
          message: '更新状态成功'
        })
        this.handleRefresh(false)
      }).catch(() => {
        this.$notification['error']({
          message: '更新状态失败'
        })
      }).finally(() => {
      })
    },
    showLogModal (record) {
      console.log('showLogModal', record)
      this.$refs.logModal.showModal(record.sourceId)
    },

    // 发配置任务
    sendConfigBatch () {
      if (this.selectedRows.length === 0) {
        this.$notification['error']({
          message: '请选择要发配置任务的行'
        })
        return false
      }
      const conf = []
      for (const line of this.selectedRows) {
        const configId = line.configId
        if (conf.indexOf(configId) === -1) {
          conf.push(configId)
        }
      }
      if (conf.length > 1) {
        this.$confirm({
          title: '提示',
          content: '是否确定要发送配置任务，本次[ ' + conf.length + ' ]条不同配置ID: [' + conf.join(',') + ']',
          onOk: () => {
            sendConfigTask(conf).then(res => {
              this.$notification['success']({
                duration: 3,
                message: '[配置]发送配置成功, 本次发送' + conf.length + ', 返回值:-' + res.msg,
                icon: <a-icon type="smile" style="color: #108ee9" />
              })
            }).catch(() => {
              this.$notification['error']({
                message: '发送配置失败'
              })
            }).finally(() => {
            })
          },
          onCancel () {
          }
        })
      } else {
        sendConfigTask(conf).then(res => {
          this.$notification['success']({
            duration: 3,
            message: '[配置]发送配置成功, 本次发送' + conf.length + ', 返回值:-' + res.msg,
            icon: <a-icon type="smile" style="color: #108ee9" />
          })
        }).catch(() => {
          this.$notification['error']({
            message: '发送配置失败'
          })
        }).finally(() => {
        })
      }
    },
    handleConfigDetail (configId) {
      console.log('detail', configId)
      this.$refs.configDetail.showModal(configId)
    }
  },
  beforeRouteEnter (to, from, next) {
    next(vm => {
      if (vm.$route.query.sourceId) {
        vm.queryParam.sourceId = vm.$route.query.sourceId
      }
      vm.handleRefresh()
    })
  }
}
</script>

<style lang="less" scoped>
a {
  color: #1890ff;
  text-decoration: none;
  background-color: transparent;
  outline: none;
  cursor: pointer;
  transition: color .3s;
  -webkit-text-decoration-skip: objects;
}
.ant-card-body {
  padding: 14px
}
.custom-tree {
  /deep/ .ant-menu-item-group-title {
    position: relative;
    &:hover {
      .btn {
        display: block;
      }
    }
  }

  /deep/ .ant-menu-item {
    &:hover {
      .btn {
        display: block;
      }
    }
  }

  /deep/ .my-bord {
    border: 1px red solid;
  }

  /deep/ .btn {
    display: none;
    position: absolute;
    top: 0;
    right: 10px;
    width: 20px;
    height: 40px;
    line-height: 40px;
    z-index: 1050;

    &:hover {
      transform: scale(1.2);
      transition: 0.5s all;
    }
  }
}

::v-deep .ant-form-item {
  font-size: 13px !important;
}
.name-class {
  padding-left: 2px;
  cursor: pointer;
  overflow: hidden;
}
.class-err {
  padding-top: 3px;
  padding-bottom: 3px;
  background-color: #fad2cb;
  text-decoration: underline;
}
/deep/ .ant-modal-header {
  padding: 8px 8px;
  color: rgba(0, 0, 0, 0.65);
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
}
/* 如果这一行被标记了 row-no-expand，就隐藏它的展开列图标 */
/deep/ .row-no-expand .el-table__expand-column .el-table__expand-icon {
  display: none !important;
}

/* 子表外观整体优化 */
/deep/ .sub-table-wrapper {
  // 调整子表单元格内边距，让内容更紧凑
  .el-table--small td,
  .el-table--small th {
    padding: 6px 0 !important; // 极小化上下边距
  }
}
/deep/ .sub-table-wrapper {
  margin-bottom: 5px;
}
</style>
