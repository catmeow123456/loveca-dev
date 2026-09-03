import { LegalDocumentLink, ProductHeader, ThemeToggle } from '@/components/common';
import {
  LEGAL_DISCLAIMER_EN,
  LEGAL_DOCUMENT_LINKS,
  LEGAL_NOTICE_ZH,
  type LegalDocumentKey,
} from '@/lib/legalPages';
import './legal-page.css';

interface LegalPageProps {
  readonly document: LegalDocumentKey;
}

const DOCUMENT_META: Record<
  LegalDocumentKey,
  { readonly eyebrow: string; readonly title: string; readonly summary: string }
> = {
  disclaimer: {
    eyebrow: 'PROJECT / DISCLAIMER',
    title: '版权与免责声明',
    summary: '说明 Cyber Loveca 的非官方身份及第三方知识产权归属。',
  },
  takedown: {
    eyebrow: 'RIGHTS / NOTICE',
    title: '权利通知',
    summary: '供权利人或其授权代表报告需要核查的内容。',
  },
  privacy: {
    eyebrow: 'DATA / PRIVACY',
    title: '隐私政策',
    summary: '说明 Cyber Loveca 在线服务处理账号、对局与浏览器数据的方式。',
  },
};

export function LegalPage({ document }: LegalPageProps) {
  const meta = DOCUMENT_META[document];

  return (
    <div className="app-shell legal-page">
      <ProductHeader
        brandAriaLabel="返回 Cyber Loveca 首页"
        brandHref="/"
        actions={<ThemeToggle />}
      />

      <main className="legal-page__main">
        <nav className="legal-page__nav" aria-label="法律文件">
          <span>CYBER LOVECA</span>
          {LEGAL_DOCUMENT_LINKS.map((item) => (
            <LegalDocumentLink key={item.key} document={item} currentDocument={document} />
          ))}
        </nav>

        <article className="legal-page__document">
          <header className="legal-page__heading">
            <span>{meta.eyebrow}</span>
            <h1>{meta.title}</h1>
            <p>{meta.summary}</p>
            <time dateTime="2026-09-03">最后更新：2026 年 9 月 3 日</time>
          </header>

          {document === 'disclaimer' ? <DisclaimerDocument /> : null}
          {document === 'takedown' ? <TakedownDocument /> : null}
          {document === 'privacy' ? <PrivacyDocument /> : null}
        </article>
      </main>
    </div>
  );
}

function DisclaimerDocument() {
  return (
    <div className="legal-copy">
      <section>
        <h2>非官方项目</h2>
        <p>{LEGAL_NOTICE_ZH}</p>
        <p lang="en" className="legal-copy__english">
          {LEGAL_DISCLAIMER_EN}
        </p>
      </section>

      <section>
        <h2>第三方权利</h2>
        <p>
          Love Live!、Love Live! Series Official Card Game
          及相关角色、卡牌图片、美术、名称、标识与商标的权利由其各自权利人保留。本站对这些第三方内容的展示不表示取得所有权，也不表示权利方对本站作出认可或授权。
        </p>
      </section>

      <section>
        <h2>规则与信息</h2>
        <p>
          本站提供玩家制作的卡组管理、规则处理、资讯整理与在线对战功能，不是官方规则发布渠道。卡牌文本、商品信息、规则或裁定存在差异时，请以官方发布内容为准。
        </p>
        <div className="legal-copy__references" aria-label="相关站点">
          <a href="https://llofficial-cardgame.com/" target="_blank" rel="noreferrer">
            Love Live! Series Official Card Game 官方网站
          </a>
          <a href="https://github.com/catmeow123456/loveca-dev" target="_blank" rel="noreferrer">
            Cyber Loveca 开源项目
          </a>
        </div>
      </section>
    </div>
  );
}

function TakedownDocument() {
  return (
    <div className="legal-copy">
      <section>
        <h2>提交权利通知</h2>
        <p>
          如果您是相关权利人或其授权代表，并认为本站展示的内容侵犯了著作权、商标权、隐私权或其他合法权利，请通过项目仓库联系维护者。为便于定位和核查，请提供：
        </p>
        <ul>
          <li>您的身份，以及您与相关权利的关系；</li>
          <li>需要核查的具体页面 URL、卡牌编号或内容位置；</li>
          <li>相关作品或权利的说明，以及您认为需要处理的理由；</li>
          <li>希望采取的处理方式，以及可用于后续联系的渠道。</li>
        </ul>
        <a
          className="legal-copy__action"
          href="https://github.com/catmeow123456/loveca-dev/issues/new"
          target="_blank"
          rel="noreferrer"
        >
          前往项目仓库提交权利通知
        </a>
      </section>

      <section>
        <h2>公开提交提醒</h2>
        <p>
          GitHub Issue
          是公开页面。请勿在首次通知中提交身份证件、账号密码、私人邮箱往来或其他敏感材料；如需提供非公开证明，请先说明需要建立私密联系渠道。
        </p>
      </section>

      <section>
        <h2>处理方式</h2>
        <p>
          维护者会根据通知内容核查具体材料，并可能在核查期间限制访问、替换来源或移除相关内容。信息不足时，维护者可能请求补充能够识别权利、材料位置和通知人权限的信息。
        </p>
        <p lang="en" className="legal-copy__english">
          Rights holders or their authorized representatives may use the project repository link
          above to report specific material. Please include the affected URL, the relevant right,
          your authority to act, and the requested action. Do not post sensitive documents in a
          public GitHub Issue.
        </p>
      </section>
    </div>
  );
}

function PrivacyDocument() {
  return (
    <div className="legal-copy">
      <section>
        <h2>适用范围</h2>
        <p>
          本政策适用于 Cyber Loveca
          公网服务。自行部署本开源项目的第三方实例由其部署者独立负责，可能采用不同的数据处理方式和保存期限。
        </p>
      </section>

      <section>
        <h2>我们处理的信息</h2>
        <ul>
          <li>账号与资料：用户名、显示名称、邮箱、密码哈希及登录会话信息；</li>
          <li>卡组与偏好：云端卡组、卡组分享状态、声音设置和自定义游戏桌壁纸；</li>
          <li>
            对局与社区功能：房间、候场、对局状态、结果、回放、排位数据，以及局内文字或快捷表情；
          </li>
          <li>运行与安全信息：请求时间、接口状态、错误和防滥用所需的有限技术信息；</li>
          <li>浏览器本地数据：离线卡组、界面偏好、房间恢复信息和必要的会话状态。</li>
        </ul>
      </section>

      <section>
        <h2>处理目的</h2>
        <p>
          上述信息用于创建和保护账号、保存卡组与偏好、完成匹配和对局、提供历史与排位功能、恢复必要会话，以及诊断故障和防止滥用。Cyber
          Loveca 不出售个人信息，也不会将账号邮箱用于营销邮件。
        </p>
      </section>

      <section>
        <h2>Cookie、本地存储与保存期限</h2>
        <p>
          登录服务使用必要的 HTTP-only Cookie 保存刷新会话，当前最长有效期为 7
          天；浏览器本地存储用于离线卡组和界面偏好，直至用户清除浏览器数据或在相应功能中重置。
        </p>
        <p>
          完整对局回放按最近 10
          天的维护策略保留，超过期限的已封存回放可以被清理；对局元数据、排位积分流水、赛季统计及用于重建卡组分类的精简观察可能为保持记录完整性而长期保留。局内聊天只存在于当前服务运行态，不写入对局历史或回放。
        </p>
      </section>

      <section>
        <h2>信息展示与服务提供者</h2>
        <p>
          用户主动分享的卡组、公开榜单中的玩家名称与成绩，以及对局参与者或获准观战者可见的局内信息，会按功能目的展示。为运行网站，必要数据可能由托管、数据库、对象存储和邮件服务提供者处理；除提供服务、履行法律义务或保护用户与系统安全所必需的情形外，不向其他第三方披露。
        </p>
      </section>

      <section>
        <h2>查询、更正与删除</h2>
        <p>
          用户可以在个人中心修改部分账号资料，并管理自己的卡组、分享和壁纸。当前尚未提供自助账号注销入口；如需查询、更正、删除个人信息或撤回相关请求，请先通过项目仓库联系维护者。
        </p>
        <a
          className="legal-copy__action"
          href="https://github.com/catmeow123456/loveca-dev/issues/new"
          target="_blank"
          rel="noreferrer"
        >
          联系项目维护者
        </a>
        <p className="legal-copy__note">
          GitHub Issue
          是公开页面，请勿填写账号密码、验证令牌或完整个人资料；首次联系只需说明请求类型，并请维护者提供后续非公开联系渠道。
        </p>
      </section>

      <section>
        <h2>政策更新</h2>
        <p>
          服务功能或数据处理方式发生实质变化时，本页面会同步更新日期和内容。继续使用前，建议查看最新版本。
        </p>
      </section>
    </div>
  );
}
