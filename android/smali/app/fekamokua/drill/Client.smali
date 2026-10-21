.class public Lapp/fekamokua/drill/Client;
.super Landroid/webkit/WebViewClient;

# 出典リンクなど http(s) のページはアプリ内ではなく外部ブラウザで開く

.field private final act:Landroid/app/Activity;

.method public constructor <init>(Landroid/app/Activity;)V
    .registers 2
    invoke-direct {p0}, Landroid/webkit/WebViewClient;-><init>()V
    iput-object p1, p0, Lapp/fekamokua/drill/Client;->act:Landroid/app/Activity;
    return-void
.end method

.method public shouldOverrideUrlLoading(Landroid/webkit/WebView;Ljava/lang/String;)Z
    .registers 6
    const-string v0, "http"
    invoke-virtual {p2, v0}, Ljava/lang/String;->startsWith(Ljava/lang/String;)Z
    move-result v0
    if-eqz v0, :keep

    new-instance v0, Landroid/content/Intent;
    const-string v1, "android.intent.action.VIEW"
    invoke-static {p2}, Landroid/net/Uri;->parse(Ljava/lang/String;)Landroid/net/Uri;
    move-result-object v2
    invoke-direct {v0, v1, v2}, Landroid/content/Intent;-><init>(Ljava/lang/String;Landroid/net/Uri;)V
    :try_start
    iget-object v1, p0, Lapp/fekamokua/drill/Client;->act:Landroid/app/Activity;
    invoke-virtual {v1, v0}, Landroid/app/Activity;->startActivity(Landroid/content/Intent;)V
    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :done
    :done
    const/4 v0, 0x1
    return v0

    :keep
    const/4 v0, 0x0
    return v0
.end method
