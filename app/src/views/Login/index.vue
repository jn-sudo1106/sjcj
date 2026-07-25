<script setup lang="ts">
import LoginForm from './components/LoginForm.vue'
import companyLogo from '@/assets/brand/company-logo.png'
import loginHero from '@/assets/brand/login-hero.png'
</script>

<template>
  <div class="lg-page">
    <header class="lg-topbar">
      <img class="lg-logo" :src="companyLogo" alt="" />
      <strong>智能采集中心</strong>
    </header>

    <div class="lg-body">
      <section class="lg-hero" aria-label="智能采集中心">
        <div class="lg-hero-copy">
          <h1>智能采集中心</h1>
          <p>高效采集 · 智能解析 · 数据驱动未来</p>
          <span aria-hidden="true"></span>
        </div>
        <img :src="loginHero" alt="智能采集中心数据安全与分析平台插画" />
      </section>

      <LoginForm />
    </div>

    <footer class="lg-footer">
      <nav>
        <a href="_self">帮助中心</a>
        <span>|</span>
        <a href="_self">隐私政策</a>
        <span>|</span>
        <a href="_self">服务条款</a>
      </nav>
      <p>Copyright © 智能采集中心 版权所有</p>
    </footer>
  </div>
</template>

<style scoped>
.lg-page {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(60% 42% at 46% 100%, rgba(255, 255, 255, 0.96) 0%, rgba(255, 255, 255, 0.7) 45%, transparent 78%),
    radial-gradient(
      48% 52% at 24% 49%,
      #fff 0%,
      rgba(255, 255, 255, 0.98) 58%,
      rgba(255, 255, 255, 0.72) 78%,
      transparent 100%
    ),
    linear-gradient(135deg, #f1f4fa 0%, #eef1f9 48%, #e7edf8 100%);
}

.lg-topbar {
  position: absolute;
  z-index: 2;
  top: 34px;
  left: 32px;
  display: flex;
  align-items: center;
  gap: 15px;
}

.lg-logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
  mix-blend-mode: multiply;
  transform: scale(1.28);
}

.lg-topbar strong {
  font-size: 27px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #0a2450;
}

.lg-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(520px, 1fr) 648px;
  align-items: center;
  gap: 26px;
  width: min(100%, 1528px);
  margin: 0 auto;
  padding: 105px 57px 133px 32px;
}

.lg-hero {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
  padding-top: 91px;
  transform: translateX(-61px);
}

.lg-hero-copy {
  position: relative;
  z-index: 1;
  text-align: center;
}

.lg-hero-copy h1 {
  margin: 0;
  color: #0b2856;
  font-size: 42px;
  line-height: 1.25;
  font-weight: 700;
  letter-spacing: 3px;
}

.lg-hero-copy p {
  margin: 19px 0 0;
  color: #5a6b88;
  font-size: 18px;
  line-height: 1.5;
  letter-spacing: 0.5px;
}

.lg-hero-copy span {
  display: block;
  width: 38px;
  height: 5px;
  margin: 20px auto 0;
  border-radius: 999px;
  background: #2f74ee;
}

.lg-hero > img {
  width: min(100%, 752px);
  height: 500px;
  margin-top: -12px;
  mix-blend-mode: multiply;
  object-fit: cover;
  object-position: center 48%;
  user-select: none;
  pointer-events: none;
}

.lg-footer {
  position: absolute;
  z-index: 2;
  bottom: 45px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  color: #596983;
  font-size: 16px;
  white-space: nowrap;
}

.lg-footer nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
}

.lg-footer nav span {
  color: #9ba7ba;
}

.lg-footer a {
  color: #52627c;
  text-decoration: none;
}

.lg-footer a:hover {
  color: #2f74ee;
}

.lg-footer p {
  margin: 16px 0 0;
}

@media (max-width: 1500px) {
  .lg-topbar {
    top: 28px;
    left: 28px;
    gap: 12px;
  }

  .lg-logo {
    width: 34px;
    height: 34px;
  }

  .lg-topbar strong {
    font-size: clamp(22px, 2.2vw, 26px);
  }

  .lg-body {
    grid-template-columns: minmax(360px, 1fr) clamp(480px, 44vw, 620px);
    gap: clamp(18px, 2vw, 26px);
    padding: clamp(78px, 10vh, 96px) 30px clamp(88px, 12vh, 110px);
  }

  .lg-hero-copy h1 {
    font-size: clamp(30px, 3vw, 36px);
  }

  .lg-hero-copy p {
    margin-top: 14px;
    font-size: 16px;
  }

  .lg-hero-copy span {
    height: 4px;
    margin-top: 16px;
  }

  .lg-hero {
    padding-top: clamp(46px, 7vh, 66px);
    transform: translateX(-20px);
  }

  .lg-hero > img {
    width: min(100%, 640px);
    height: clamp(340px, 45vh, 430px);
    margin-top: -6px;
  }

  .lg-footer {
    bottom: clamp(24px, 4vh, 38px);
    font-size: 14px;
  }

  .lg-footer p {
    margin-top: 12px;
  }
}

@media (max-width: 960px) {
  .lg-page {
    height: auto;
    min-height: 100vh;
    overflow: auto;
  }

  .lg-topbar {
    top: 24px;
    left: 24px;
  }

  .lg-logo {
    width: 32px;
    height: 32px;
  }

  .lg-topbar strong {
    font-size: 22px;
  }

  .lg-body {
    display: flex;
    justify-content: center;
    padding: 88px 20px 116px;
  }

  .lg-hero {
    display: none;
    transform: none;
  }
}

@media (max-width: 560px) {
  .lg-topbar {
    top: 20px;
    left: 20px;
  }

  .lg-body {
    align-items: flex-start;
    padding: 88px 12px 128px;
  }

  .lg-footer {
    bottom: 24px;
    font-size: 12px;
  }

  .lg-footer nav {
    gap: 12px;
  }

  .lg-footer p {
    margin-top: 10px;
  }
}

@media (max-height: 900px) and (min-width: 1501px) {
  .lg-topbar {
    top: 26px;
    left: 28px;
    gap: 12px;
  }

  .lg-logo {
    width: 34px;
    height: 34px;
  }

  .lg-topbar strong {
    font-size: 24px;
  }

  .lg-body {
    grid-template-columns: minmax(520px, 1fr) 560px;
    gap: 24px;
    width: min(100%, 1420px);
    padding: 74px 57px 180px 32px;
  }

  .lg-hero {
    padding-top: 48px;
    transform: translateX(-40px);
  }

  .lg-hero-copy h1 {
    font-size: 36px;
  }

  .lg-hero-copy p {
    margin-top: 14px;
    font-size: 16px;
  }

  .lg-hero-copy span {
    height: 4px;
    margin-top: 16px;
  }

  .lg-hero > img {
    width: min(100%, 650px);
    height: 400px;
    margin-top: -6px;
  }

  .lg-footer {
    bottom: 18px;
    font-size: 14px;
  }

  .lg-footer nav {
    gap: 22px;
  }

  .lg-footer p {
    margin-top: 10px;
  }
}
</style>
