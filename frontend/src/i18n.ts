export type Lang = 'ru' | 'en'

export const translations = {
  ru: {
    // Auth
    signIn: 'Войти',
    welcomeBack: 'С возвращением в кинотеатр',
    username: 'Логин',
    password: 'Пароль',
    signingIn: 'Вход…',
    noAccount: 'Нет аккаунта?',
    createOne: 'Создать',
    createAccount: 'Создать аккаунт',
    joinCinema: 'Присоединиться к кинотеатру',
    email: 'Электронная почта',
    minChars: 'Минимум 6 символов',
    creatingAccount: 'Создание аккаунта…',
    haveAccount: 'Уже есть аккаунт?',

    // Navbar
    searchLibrary: 'Поиск в библиотеке…',
    import: 'Импорт',
    downloads: 'Загрузки',
    createHall: 'Создать зал',
    settings: 'Настройки',
    signOut: 'Выйти',
    langToggleLabel: 'EN',

    // Dashboard
    welcomeBackUser: 'С возвращением,',
    readyToStart: 'Готовы начать показ?',
    filmsReady: 'фильмов готово',
    activeHallsStat: 'активных залов',
    syncReady: 'Синхронизация готова',
    myMediaLibrary: 'Моя медиатека',
    filmsCount: 'фильмов',
    noFilmsYet: 'Нет фильмов',
    importTorrentToStart: 'Импортируйте торрент для начала',
    openDownloads: 'Открыть загрузки',
    processing: 'Обработка',
    filesCount: 'файлов',
    activeHallsSection: 'Активные залы',
    newHall: 'Новый',
    noActiveHalls: 'Нет активных залов',
    createHallInvite: 'Создайте зал и пригласите друзей',
    createAHall: 'Создать зал',

    // Settings tabs
    settingsTitle: 'Настройки',
    profile: 'Профиль',
    playback: 'Воспроизведение',
    account: 'Аккаунт',
    changesSaved: 'Изменения сохранены',

    // Settings profile tab
    displayName: 'Отображаемое имя',
    yourNickname: 'Ваш никнейм',
    shownInRooms: 'Отображается в залах и чате',
    cannotBeChanged: 'Нельзя изменить',
    changePassword: 'Изменить пароль',
    currentPassword: 'Текущий пароль',
    newPassword: 'Новый пароль (мин. 6 символов)',
    leaveBlank: 'Оставьте пустым, чтобы не менять пароль',
    saving: 'Сохранение…',
    saveProfile: 'Сохранить профиль',

    // Settings playback tab
    defaultQuality: 'Качество по умолчанию',
    defaultAudioLang: 'Язык аудио по умолчанию',
    unknownAny: 'Неизвестно / Любой',
    defaultSubtitles: 'Субтитры по умолчанию',
    off: 'Выкл',
    autoSync: 'Авто-синхронизация при входе',
    autoSyncDesc: 'Подключаться к позиции лидера при входе в зал',
    savePlayback: 'Сохранить настройки воспроизведения',

    // Settings downloads tab
    maxConcurrentDownloads: 'Макс. одновременных загрузок',
    maxConcurrentDesc: 'Сколько торрентов скачивается одновременно — больше означает больше трафика и нагрузки на CPU',
    saveDownloads: 'Сохранить настройки загрузок',

    // Settings account tab
    memberSince: 'Участник с',
    dangerZone: 'Опасная зона',
    deleteAccountDesc: 'Безвозвратно удалить аккаунт и все связанные данные. Это нельзя отменить.',
    typeDeleteConfirm: 'Введите DELETE для подтверждения',
    deleting: 'Удаление…',
    deleteAccountPermanently: 'Удалить аккаунт навсегда',

    // CreateRoomModal
    createCinemaHall: 'Создать кинозал',
    youllBeLeader: 'Вы станете лидером',
    hallName: 'Название зала',
    movieNight: 'Киновечер',
    film: 'Фильм',
    noFilmsDownloaded: 'Нет скачанных фильмов',
    importTorrentFirst: 'Сначала импортируйте торрент на странице загрузок',
    seatLimit: 'Лимит мест',
    cancel: 'Отмена',

    // MediaCard
    processingDots: 'Обработка…',
    error: 'Ошибка',
    ready: 'Готово',
    processingBadge: 'Обработка',
    watch: 'Смотреть',
    deleteMedia: 'Удалить фильм',

    // Misc
    audio: 'аудио',
    subs: 'субт.',
    english: 'Английский',
    french: 'Французский',
    spanish: 'Испанский',
    german: 'Немецкий',
    russian: 'Русский',
    japanese: 'Японский',
    auto: 'Авто',
  },
  en: {
    // Auth
    signIn: 'Sign in',
    welcomeBack: 'Welcome back to the cinema',
    username: 'Username',
    password: 'Password',
    signingIn: 'Signing in…',
    noAccount: "Don't have an account?",
    createOne: 'Create one',
    createAccount: 'Create account',
    joinCinema: 'Join the private cinema',
    email: 'Email',
    minChars: 'Min 6 characters',
    creatingAccount: 'Creating account…',
    haveAccount: 'Already have an account?',

    // Navbar
    searchLibrary: 'Search library…',
    import: 'Import',
    downloads: 'Downloads',
    createHall: 'Create Hall',
    settings: 'Settings',
    signOut: 'Sign out',
    langToggleLabel: 'RU',

    // Dashboard
    welcomeBackUser: 'Welcome back,',
    readyToStart: 'Ready to start a screening?',
    filmsReady: 'films ready',
    activeHallsStat: 'active halls',
    syncReady: 'Sync ready',
    myMediaLibrary: 'My Media Library',
    filmsCount: 'films',
    noFilmsYet: 'No films yet',
    importTorrentToStart: 'Import a torrent to get started',
    openDownloads: 'Open Downloads',
    processing: 'Processing',
    filesCount: 'files',
    activeHallsSection: 'Active Halls',
    newHall: 'New',
    noActiveHalls: 'No active halls',
    createHallInvite: 'Create a hall and invite your friends',
    createAHall: 'Create a Hall',

    // Settings tabs
    settingsTitle: 'Settings',
    profile: 'Profile',
    playback: 'Playback',
    account: 'Account',
    changesSaved: 'Changes saved',

    // Settings profile tab
    displayName: 'Display name',
    yourNickname: 'Your nickname',
    shownInRooms: 'Shown in rooms and chat',
    cannotBeChanged: 'Cannot be changed',
    changePassword: 'Change password',
    currentPassword: 'Current password',
    newPassword: 'New password (min 6 chars)',
    leaveBlank: 'Leave blank to keep current password',
    saving: 'Saving…',
    saveProfile: 'Save profile',

    // Settings playback tab
    defaultQuality: 'Default quality',
    defaultAudioLang: 'Default audio language',
    unknownAny: 'Unknown / Any',
    defaultSubtitles: 'Default subtitles',
    off: 'Off',
    autoSync: 'Auto-sync on join',
    autoSyncDesc: "Snap to leader's position when entering a room",
    savePlayback: 'Save playback settings',

    // Settings downloads tab
    maxConcurrentDownloads: 'Max concurrent downloads',
    maxConcurrentDesc: 'How many torrents download at once — more means more bandwidth and CPU usage',
    saveDownloads: 'Save download settings',

    // Settings account tab
    memberSince: 'Member since',
    dangerZone: 'Danger zone',
    deleteAccountDesc: 'Permanently delete your account and all associated data. This cannot be undone.',
    typeDeleteConfirm: 'Type DELETE to confirm',
    deleting: 'Deleting…',
    deleteAccountPermanently: 'Delete account permanently',

    // CreateRoomModal
    createCinemaHall: 'Create Cinema Hall',
    youllBeLeader: "You'll become the Leader",
    hallName: 'Hall Name',
    movieNight: 'Movie Night',
    film: 'Film',
    noFilmsDownloaded: 'No films downloaded',
    importTorrentFirst: 'Import a torrent first from the Downloads section',
    seatLimit: 'Seat Limit',
    cancel: 'Cancel',

    // MediaCard
    processingDots: 'Processing…',
    error: 'Error',
    ready: 'Ready',
    processingBadge: 'Processing',
    watch: 'Watch',
    deleteMedia: 'Delete film',

    // Misc
    audio: 'audio',
    subs: 'subs',
    english: 'English',
    french: 'French',
    spanish: 'Spanish',
    german: 'German',
    russian: 'Russian',
    japanese: 'Japanese',
    auto: 'Auto',
  },
} as const

export type T = typeof translations.ru
