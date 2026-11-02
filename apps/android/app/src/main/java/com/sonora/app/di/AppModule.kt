package com.sonora.app.di

import android.content.Context
import androidx.room.Room
import com.sonora.app.BuildConfig
import com.sonora.app.data.db.SonoraDatabase
import com.sonora.app.data.net.AuthInterceptor
import com.sonora.app.data.net.SonoraApi
import com.sonora.app.data.net.TokenAuthenticator
import com.sonora.app.data.repo.ServerAddress
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides @Singleton
    fun json(): Json = Json {
        ignoreUnknownKeys = true
        // Fields with Kotlin defaults (e.g. device.platform = "android") must still be sent.
        encodeDefaults = true
        explicitNulls = false
        coerceInputValues = true
    }

    /** Requests are written against a placeholder host and re-pointed at the configured server. */
    @Provides @Singleton
    fun hostRewrite(server: ServerAddress): Interceptor = Interceptor { chain ->
        val request = chain.request()
        if (request.url.host != PLACEHOLDER_HOST) return@Interceptor chain.proceed(request)
        val base = server.current().toHttpUrl()
        val url = request.url.newBuilder().scheme(base.scheme).host(base.host).port(base.port).build()
        chain.proceed(request.newBuilder().url(url).build())
    }

    @Provides @Singleton @Named("api")
    fun apiClient(rewrite: Interceptor, auth: AuthInterceptor, authenticator: TokenAuthenticator): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(rewrite)
            .addInterceptor(auth)
            .authenticator(authenticator)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .apply {
                if (BuildConfig.DEBUG) addInterceptor(HttpLoggingInterceptor().setLevel(HttpLoggingInterceptor.Level.BASIC))
            }
            .build()

    /** Media (HLS playlists, segments, artwork): no auth header, longer reads. */
    @Provides @Singleton @Named("media")
    fun mediaClient(rewrite: Interceptor): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(rewrite)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()

    @Provides @Singleton
    fun api(@Named("api") client: OkHttpClient, json: Json): SonoraApi =
        Retrofit.Builder()
            .baseUrl("http://$PLACEHOLDER_HOST/")
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(SonoraApi::class.java)

    @Provides @Singleton
    fun database(@ApplicationContext context: Context): SonoraDatabase =
        Room.databaseBuilder(context, SonoraDatabase::class.java, "sonora.db")
            .fallbackToDestructiveMigration()
            .build()

    const val PLACEHOLDER_HOST = "sonora.invalid"
    val DEFAULT_BASE_URL: String = BuildConfig.DEFAULT_BASE_URL
}
