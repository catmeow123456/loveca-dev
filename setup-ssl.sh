#!/bin/bash
# ============================================
# SSL Certificate Setup Script for lovelivefun.xyz
# 使用 acme.sh + 阿里云 DNS API
# ============================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ============================================
# 配置区域 - 请填写您的阿里云 DNS API 凭证
# ============================================
# export Ali_Key=
# export Ali_Secret=

# 域名配置
DOMAIN="lovelivefun.xyz"
WILDCARD_DOMAIN="*.lovelivefun.xyz"

# 证书存放路径
CERT_DIR="/etc/nginx/ssl/${DOMAIN}"
ACME_HOME="$HOME/.acme.sh"

# ============================================
# 检查前置条件
# ============================================
check_prerequisites() {
    log_info "检查前置条件..."
    
    # 检查 acme.sh 是否存在
    if [ ! -f "$ACME_HOME/acme.sh" ]; then
        log_error "acme.sh 未找到，请先安装 acme.sh"
        log_info "安装命令: curl https://get.acme.sh | sh"
        exit 1
    fi
    
    # 检查阿里云凭证是否已配置
    if [ "$Ali_Key" = "YOUR_ALI_KEY_HERE" ] || [ "$Ali_Secret" = "YOUR_ALI_SECRET_HERE" ]; then
        log_error "请先配置阿里云 DNS API 凭证"
        log_info "编辑此脚本，填写 Ali_Key 和 Ali_Secret"
        exit 1
    fi
    
    # 检查 nginx 是否安装
    if ! command -v nginx &> /dev/null; then
        log_error "nginx 未安装"
        exit 1
    fi
    
    log_info "前置条件检查通过"
}

# ============================================
# 创建证书目录
# ============================================
create_cert_dir() {
    log_info "创建证书目录: $CERT_DIR"
    mkdir -p "$CERT_DIR"
}

# ============================================
# 申请 SSL 证书
# ============================================
issue_certificate() {
    log_info "开始申请 SSL 证书..."
    log_info "域名: $DOMAIN, $WILDCARD_DOMAIN"
    
    # 使用阿里云 DNS API 申请证书
    "$ACME_HOME/acme.sh" --issue \
        --dns dns_ali \
        -d "$DOMAIN" \
        -d "$WILDCARD_DOMAIN" \
        --keylength ec-256 \
        --server letsencrypt \
        --log
    
    if [ $? -eq 0 ]; then
        log_info "证书申请成功！"
    else
        log_error "证书申请失败"
        exit 1
    fi
}

# ============================================
# 安装证书到 nginx
# ============================================
install_certificate() {
    log_info "安装证书到 nginx..."
    
    "$ACME_HOME/acme.sh" --install-cert \
        -d "$DOMAIN" \
        -d "$WILDCARD_DOMAIN" \
        --ecc \
        --key-file "$CERT_DIR/privkey.pem" \
        --fullchain-file "$CERT_DIR/fullchain.pem" \
        --reloadcmd "systemctl reload nginx" \
        --log
    
    if [ $? -eq 0 ]; then
        log_info "证书安装成功！"
        log_info "证书路径: $CERT_DIR/fullchain.pem"
        log_info "私钥路径: $CERT_DIR/privkey.pem"
    else
        log_error "证书安装失败"
        exit 1
    fi
}

# ============================================
# 验证证书
# ============================================
verify_certificate() {
    log_info "验证证书..."
    
    if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
        log_info "证书文件验证通过"
        
        # 显示证书信息
        log_info "证书详情:"
        openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -subject -dates
    else
        log_error "证书文件不存在"
        exit 1
    fi
}

# ============================================
# 测试 nginx 配置
# ============================================
test_nginx() {
    log_info "测试 nginx 配置..."
    
    if nginx -t; then
        log_info "nginx 配置测试通过"
    else
        log_error "nginx 配置有误，请检查配置文件"
        exit 1
    fi
}

# ============================================
# 重载 nginx
# ============================================
reload_nginx() {
    log_info "重载 nginx..."
    systemctl reload nginx
    log_info "nginx 已重载"
}

# ============================================
# 显示自动续期信息
# ============================================
show_renewal_info() {
    echo ""
    log_info "============================================"
    log_info "SSL 证书配置完成！"
    log_info "============================================"
    echo ""
    log_info "证书信息:"
    echo "  - 域名: $DOMAIN, $WILDCARD_DOMAIN"
    echo "  - 证书路径: $CERT_DIR/fullchain.pem"
    echo "  - 私钥路径: $CERT_DIR/privkey.pem"
    echo ""
    log_info "自动续期:"
    echo "  - acme.sh 已自动配置 cron 任务"
    echo "  - 证书将在到期前自动续期"
    echo "  - 续期后会自动 reload nginx"
    echo ""
    log_info "查看 cron 任务: crontab -l"
    log_info "手动续期测试: $ACME_HOME/acme.sh --renew -d $DOMAIN --ecc --force"
    echo ""
}

# ============================================
# 主函数
# ============================================
main() {
    echo ""
    echo "============================================"
    echo "  SSL Certificate Setup Script"
    echo "  Domain: $DOMAIN"
    echo "============================================"
    echo ""
    
    check_prerequisites
    create_cert_dir
    issue_certificate
    install_certificate
    verify_certificate
    test_nginx
    reload_nginx
    show_renewal_info
}

# 运行主函数
main "$@"
