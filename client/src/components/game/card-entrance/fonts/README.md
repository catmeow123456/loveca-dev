# 登场姓名字体

`entrance-names-heavy.woff2` 是 Adobe Source Han Serif SC Heavy（思源宋体 Heavy）的姓名子集，派生字体改名为 Loveca Entrance。保留版权及 SIL Open Font License，见同目录 `OFL.txt`。官方源文件：

https://github.com/adobe-fonts/source-han-serif/blob/release/OTF/SimplifiedChinese/SourceHanSerifSC-Heavy.otf

仅包含 `cardEntranceProfiles.ts` 中登记的姓名与空格，组合卡的 `&` 随姓名纳入。新增或修改姓名时，在装有 `fonttools[woff]` 的制作环境执行：

```sh
python scripts/build-entrance-name-font.py /path/to/SourceHanSerifSC-Heavy.otf
```

完整 OTF 与 Python 工具不参与生产部署；提交生成的 WOFF2 即可。运行时按需请求，纳入既有两秒素材准备期限；字体加载失败保留宋体后备，资源整体超时仍按既有取消逻辑结束演出。
