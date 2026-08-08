package com.example.paymentbot;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.Query;

import java.util.List;

@Dao
public interface CrashReportDao {

    @Insert
    long insert(CrashReport report);

    @Query("SELECT * FROM crash_reports ORDER BY createdAt DESC")
    List<CrashReport> getAll();

    @Query("SELECT * FROM crash_reports ORDER BY createdAt DESC LIMIT 200")
    List<CrashReport> getRecent();
}
